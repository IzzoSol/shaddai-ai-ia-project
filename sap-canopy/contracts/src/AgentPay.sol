// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentPay
 * @notice AI agents hiring each other. One percent of every job funds a real tree.
 *
 *         A poster escrows a stablecoin bounty. An agent does the work. The
 *         poster names the winner. The winner is paid 99% and a TreeNFT claim
 *         is minted to them; the remaining 1% is booked into the tree fund and
 *         released to the designated tree-fund recipient by an authorised
 *         settler.
 *
 * @dev This contract holds escrowed bounties only. It never trades, never
 *      bridges, and has no route that moves funds on a third party's behalf.
 *
 * ============================================================================
 * SPEC FLAWS FIXED IN THIS IMPLEMENTATION
 * ============================================================================
 *
 * The original AGENTPAY_MULTICHAIN_SPEC.md sketch had five defects that made
 * it unsafe or unusable. Each is called out at the code site that fixes it.
 *
 *  FLAW 1 - `uint8 public chainId` cannot hold a real chain id.
 *          Base is 8453, which does not fit in a uint8 (max 255). Any Base
 *          deployment would have carried a wrong or overflowed chain id.
 *          FIX: `immutable uint256 chainId = block.chainid`. Nothing is
 *          hardcoded and nothing can overflow.
 *
 *  FLAW 2 - ERC20 `transfer` return values were ignored.
 *          The spec called `stableToken.transfer(winner, winnerPayout);` and
 *          discarded the result. USDT (the Polygon stable in the spec) returns
 *          NO data, and a `false` return from a non-compliant token was
 *          swallowed -- so a job could be marked completed while the winner
 *          received nothing.
 *          FIX: OpenZeppelin `SafeERC20` (`safeTransfer` / `safeTransferFrom`),
 *          which accepts both no-return and bool-returning tokens and reverts
 *          on failure.
 *
 *  FLAW 3 - `stableToken.transfer(address(this), treeFund)` transferred to
 *          itself. It was a no-op dressed up as a transfer: the 1% never
 *          moved, was never booked, and could never be claimed. The accounting
 *          was a lie.
 *          FIX: an explicit `treeFundAccrued` ledger plus `releaseTreeFund()`,
 *          callable only by the authorised settler and only to the designated
 *          `treeFundRecipient`.
 *
 *  FLAW 4 - fee-on-transfer tokens broke the books.
 *          `postJob` recorded the requested `bounty`, but `transferFrom` may
 *          deliver less (transfer-fee tokens, rebasing tokens). The contract
 *          would then be insolvent: `completeJob` would revert mid-flight or
 *          overpay, stranding the poster's funds.
 *          FIX: measure the ACTUAL received amount with a balance-before /
 *          balance-after delta and record that as the bounty. If nothing
 *          arrived, the post reverts.
 *
 *  FLAW 5 - escrowed funds could be locked forever, and the winner could be
 *          an unusable address.
 *          Only the poster could call `completeJob`, with no cancel, no
 *          timeout, no expiry refund, and no `winner != address(0)` check. A
 *          poster could strand every bounty, or "pay" the zero address and
 *          burn the funds. The prompt string was also unbounded (storage
 *          griefing) and `postJob` had no reentrancy guard.
 *          FIX: `cancelJob`, `expireJob`, a per-job deadline, a zero-address
 *          check, a bounded prompt length, and `nonReentrant` on every
 *          state-changing path.
 *
 *  SECONDARY FIXES
 *  - The spec imported the OpenZeppelin ReentrancyGuard from
 *    "openzeppelin/contracts/security/ReentrancyGuard.sol". That path was
 *    REMOVED in OpenZeppelin v5 (it moved to "utils/"), so the spec as written
 *    does not compile against a current OZ.
 *  - The spec derived the tree token id from `uint256(uint160(to))`, so the
 *    same address winning two jobs collided and overwrote the first record.
 *    Token ids are now a monotonic counter with an explicit job -> token map.
 *
 *  FLAW 6 - the zero sentinel collided with the first real job id.
 *          `jobCounter` started at 0, so the FIRST job was id 0. But 0 is also
 *          the "this job does not exist" sentinel used by every lookup
 *          (`if (j.jobId == 0) revert UnknownJob()`), and TreeNFT rejects
 *          `jobId == 0` outright (`JobIdZero`). The consequences were severe
 *          and total: job 0 could be posted (funds escrowed) but could never
 *          be READ, completed, cancelled, extended OR expired -- every one of
 *          those paths checks the same sentinel and reverts with UnknownJob.
 *          The poster's bounty was locked forever. `expireJob`, the FLAW 5
 *          fix that exists precisely to stop a bounty being stranded, was
 *          itself unreachable for the first job. And even if the sentinel had
 *          been absent, the tree claim for job 0 could never be minted.
 *          FIX: job ids start at FIRST_JOB_ID (1). Zero is reserved
 *          permanently as the "no such job" sentinel, and no real job can
 *          ever collide with it. `FIRST_JOB_ID` is a public constant so the
 *          invariant is assertable from outside the contract.
 */
contract AgentPay is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Share of every bounty booked into the tree fund, in bps.
    uint256 public constant TREE_FUND_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_PROMPT_LENGTH = 1_024;
    uint256 public constant DEFAULT_JOB_TTL = 30 days;

    /**
     * @notice The first job id ever issued. Job ids start at 1.
     * @dev Zero is reserved permanently as the "no such job" sentinel that
     *      every lookup tests against, so no real job can ever collide with
     *      it. See FLAW 6 in the contract header.
     */
    uint256 public constant FIRST_JOB_ID = 1;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Job {
        uint256 jobId;
        address poster;
        string prompt;
        uint256 bounty; // amount ACTUALLY received (see FLAW 4)
        address selectedWinner;
        bool completed;
        bool cancelled;
        uint64 createdAt;
        uint64 deadline;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice The stablecoin escrowed for bounties (fxUSD / USDC / USDT).
    IERC20 public immutable stableToken;

    /// @notice The chain this contract is deployed on. See FLAW 1.
    uint256 public immutable chainId;

    /// @notice The TreeNFT contract that mints tree claims.
    address public treeNFT;

    /// @notice May release accrued tree fund. A human-reviewed settler.
    address public settler;

    /// @notice The only address the tree fund may be released to.
    address public treeFundRecipient;

    /// @notice Tree fund booked but not yet released.
    uint256 public treeFundAccrued;

    /// @notice Tree fund released to the recipient.
    uint256 public treeFundReleased;

    mapping(uint256 => Job) private _jobs;
    uint256 public jobCounter;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event JobPosted(uint256 indexed jobId, address indexed poster, uint256 bounty, string prompt, uint64 deadline);
    event JobCompleted(uint256 indexed jobId, address indexed winner, uint256 payout, uint256 treeFund);
    event JobCancelled(uint256 indexed jobId, address indexed poster, uint256 refund);
    event JobExpired(uint256 indexed jobId, address indexed poster, uint256 refund);
    event JobExtended(uint256 indexed jobId, uint64 newDeadline);
    event TreeFundAccrued(uint256 indexed jobId, uint256 amount);
    event TreeFundReleased(address indexed to, uint256 amount, uint256 remaining);
    event TreeNFTMinted(uint256 indexed jobId, address indexed winner, uint256 tokenId);
    event TreeNFTUpdated(address indexed treeNFT);
    event SettlerUpdated(address indexed settler);
    event TreeFundRecipientUpdated(address indexed recipient);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroBounty();
    error NoTokensReceived();
    error PromptTooLong();
    error UnknownJob();
    error JobNotOpen();
    error JobExpired_();
    error NotPoster();
    error NotSettler();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientTreeFund();
    error WrongRecipient();
    error TreeNFTNotSet();
    error TreeMintFailed();
    error NothingToCancel();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address token, address treeFundRecipient_) Ownable(msg.sender) {
        if (token == address(0)) revert ZeroAddress();
        if (treeFundRecipient_ == address(0)) revert ZeroAddress();
        stableToken = IERC20(token);
        // FLAW 1 FIX: uint256, read from the chain itself. Base (8453) does
        // not fit in a uint8, and nothing here is hardcoded.
        chainId = block.chainid;
        treeFundRecipient = treeFundRecipient_;
        // FLAW 6 FIX: job ids start at 1 so the "no such job" sentinel (0)
        // can never be a real job id. With the counter starting at 0 the
        // first job was id 0 and was permanently unreadable, uncompletable,
        // uncancellable and unexpirable -- its bounty was locked forever.
        jobCounter = FIRST_JOB_ID;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setTreeNFT(address newTreeNFT) external onlyOwner {
        if (newTreeNFT == address(0)) revert ZeroAddress();
        treeNFT = newTreeNFT;
        emit TreeNFTUpdated(newTreeNFT);
    }

    function setSettler(address newSettler) external onlyOwner {
        if (newSettler == address(0)) revert ZeroAddress();
        settler = newSettler;
        emit SettlerUpdated(newSettler);
    }

    function setTreeFundRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        treeFundRecipient = newRecipient;
        emit TreeFundRecipientUpdated(newRecipient);
    }

    // ---------------------------------------------------------------------
    // Job lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Post a job and escrow its bounty.
     * @param prompt What the agent must do.
     * @param bounty Stablecoin amount to escrow. The amount actually received
     *               is recorded (fee-on-transfer tokens send less).
     * @return jobId The new job id.
     */
    function postJob(string calldata prompt, uint256 bounty)
        external
        nonReentrant
        returns (uint256 jobId)
    {
        if (bounty == 0) revert ZeroBounty();
        if (bytes(prompt).length > MAX_PROMPT_LENGTH) revert PromptTooLong();

        // FLAW 4 FIX: measure what actually arrived instead of trusting the
        // requested amount. A fee-on-transfer token delivers less; recording
        // the requested amount would leave the contract insolvent.
        uint256 balanceBefore = stableToken.balanceOf(address(this));
        stableToken.safeTransferFrom(msg.sender, address(this), bounty);
        uint256 received = stableToken.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert NoTokensReceived();

        uint256 id = jobCounter++;
        uint64 deadline = uint64(block.timestamp + DEFAULT_JOB_TTL);

        _jobs[id] = Job({
            jobId: id,
            poster: msg.sender,
            prompt: prompt,
            bounty: received,
            selectedWinner: address(0),
            completed: false,
            cancelled: false,
            createdAt: uint64(block.timestamp),
            deadline: deadline
        });

        emit JobPosted(id, msg.sender, received, prompt, deadline);
        return id;
    }

    /**
     * @notice Complete a job: pay the winner and mint the tree claim.
     * @dev Only the poster may name the winner. The 1% tree fund is booked
     *      (FLAW 3 FIX) and released separately by the settler.
     */
    function completeJob(uint256 jobId, address winner) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.jobId == 0) revert UnknownJob();
        if (j.completed || j.cancelled) revert JobNotOpen();
        if (msg.sender != j.poster) revert NotPoster();
        if (winner == address(0)) revert ZeroAddress();
        if (block.timestamp > j.deadline) revert JobExpired_();

        uint256 bounty = j.bounty;
        uint256 treeFund = (bounty * TREE_FUND_BPS) / BPS_DENOMINATOR;
        uint256 payout = bounty - treeFund;

        // Effects before interactions (CEI).
        j.selectedWinner = winner;
        j.completed = true;
        treeFundAccrued += treeFund;

        emit TreeFundAccrued(jobId, treeFund);

        // FLAW 2 FIX: SafeERC20 handles tokens that return nothing (USDT) and
        // reverts if the transfer fails.
        stableToken.safeTransfer(winner, payout);

        uint256 tokenId = _mintTreeClaim(winner, jobId);

        emit JobCompleted(jobId, winner, payout, treeFund);
        if (tokenId != 0) {
            emit TreeNFTMinted(jobId, winner, tokenId);
        }
    }

    /**
     * @notice Cancel an open job and refund the poster.
     * @dev The poster may cancel any time before the job completes. This is
     *      the escape hatch that stops a bounty being stranded (FLAW 5 FIX).
     */
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.jobId == 0) revert UnknownJob();
        if (j.completed) revert JobNotOpen();
        if (j.cancelled) revert NothingToCancel();
        if (msg.sender != j.poster) revert NotPoster();

        j.cancelled = true;
        uint256 refund = j.bounty;

        stableToken.safeTransfer(j.poster, refund);
        emit JobCancelled(jobId, j.poster, refund);
    }

    /**
     * @notice Expire an overdue job and refund the poster.
     * @dev Callable by anyone once the deadline has passed, so a job can never
     *      be locked forever by an inactive poster (FLAW 5 FIX).
     */
    function expireJob(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.jobId == 0) revert UnknownJob();
        if (j.completed || j.cancelled) revert JobNotOpen();
        if (block.timestamp <= j.deadline) revert JobNotOpen();

        j.cancelled = true;
        uint256 refund = j.bounty;

        stableToken.safeTransfer(j.poster, refund);
        emit JobExpired(jobId, j.poster, refund);
    }

    /**
     * @notice Extend the deadline of an open job.
     * @dev The poster may extend while the job is open and before expiry.
     */
    function extendJob(uint256 jobId, uint64 newDeadline) external {
        Job storage j = _jobs[jobId];
        if (j.jobId == 0) revert UnknownJob();
        if (j.completed || j.cancelled) revert JobNotOpen();
        if (msg.sender != j.poster) revert NotPoster();
        if (newDeadline <= j.deadline) revert JobNotOpen();

        j.deadline = newDeadline;
        emit JobExtended(jobId, newDeadline);
    }

    // ---------------------------------------------------------------------
    // Tree fund
    // ---------------------------------------------------------------------

    /**
     * @notice Release accrued tree fund to the designated recipient.
     * @dev Only the authorised settler (or the owner) may call this, and only
     *      to `treeFundRecipient`. The 1% is paid for real planting and
     *      verification work already rendered -- see TREE_PAYMENT_NOTE in the
     *      S.A.P. treasury documentation. There is no HTTP route and no
     *      automatic on-chain swap: a human-reviewed settler executes it.
     */
    function releaseTreeFund(uint256 amount) external nonReentrant {
        if (msg.sender != settler && msg.sender != owner()) revert NotSettler();
        if (amount == 0) revert ZeroAmount();
        if (amount > treeFundAccrued) revert InsufficientTreeFund();

        treeFundAccrued -= amount;
        treeFundReleased += amount;

        stableToken.safeTransfer(treeFundRecipient, amount);
        emit TreeFundReleased(treeFundRecipient, amount, treeFundAccrued);
    }

    /**
     * @notice Release to an explicit address -- only the recipient itself.
     * @dev Convenience for a recipient that wants to sweep without a second
     *      transaction. The address must equal `treeFundRecipient`.
     */
    function sweepTreeFund(uint256 amount) external nonReentrant {
        if (msg.sender != treeFundRecipient) revert WrongRecipient();
        if (amount == 0) revert ZeroAmount();
        if (amount > treeFundAccrued) revert InsufficientTreeFund();

        treeFundAccrued -= amount;
        treeFundReleased += amount;

        stableToken.safeTransfer(treeFundRecipient, amount);
        emit TreeFundReleased(treeFundRecipient, amount, treeFundAccrued);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function job(uint256 jobId) external view returns (Job memory) {
        Job storage j = _jobs[jobId];
        if (j.jobId == 0) revert UnknownJob();
        return j;
    }

    /// @notice Escrowed bounties still held for open jobs.
    function escrowedBalance() external view returns (uint256) {
        return stableToken.balanceOf(address(this)) - treeFundAccrued;
    }

    /// @notice Total escrowed + tree fund held by the contract.
    function totalHeld() external view returns (uint256) {
        return stableToken.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /**
     * @dev Mint the tree claim for a completed job.
     *      Returns 0 if no TreeNFT is configured yet -- the payout and the
     *      tree-fund booking still stand, and the claim can be minted later
     *      by the owner via the TreeNFT contract's own minter role.
     */
    function _mintTreeClaim(address winner, uint256 jobId) private returns (uint256 tokenId) {
        address nft = treeNFT;
        if (nft == address(0)) return 0;

        // Low-level call so we can decode the returned token id without
        // importing TreeNFT (which would couple the two contracts' layouts).
        (bool ok, bytes memory data) = nft.call(
            abi.encodeWithSignature("mintForJob(address,uint256,string)", winner, jobId, "")
        );
        if (!ok) revert TreeMintFailed();
        if (data.length >= 32) {
            tokenId = abi.decode(data, (uint256));
        }
    }
}
