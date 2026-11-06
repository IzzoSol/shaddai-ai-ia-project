// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentPay} from "../src/AgentPay.sol";
import {TreeNFT} from "../src/TreeNFT.sol";
import {MockERC20, NoReturnToken, FalseReturnToken, FeeOnTransferToken} from "./mocks/Mocks.sol";

/**
 * @title AgentPay Foundry suite
 * @notice The Foundry equivalent of scripts/test.js. Written to the SAME
 *         assertions as the ganache + ethers harness, because Foundry is not
 *         installed on this machine and the ganache suite is what actually
 *         runs today.
 *
 *         Run with:
 *             forge install foundry-rs/forge-std --no-commit
 *             forge test -vvv
 *
 * @dev Each test names the spec flaw it pins down, so a failure reads as a
 *      regression against a named defect rather than a mystery.
 */
contract AgentPayTest is Test {
    MockERC20 token;
    TreeNFT nft;
    AgentPay pay;

    address poster = address(0xA11CE);
    address winner = address(0xB0B);
    address treeFundRecipient = address(0x7EE);
    address settler = address(0x5E77);
    address stranger = address(0xBAD);

    uint256 constant BOUNTY = 100_000;

    function setUp() public {
        token = new MockERC20();
        nft = new TreeNFT(address(this)); // owner acts as the verifier
        pay = new AgentPay(address(token), treeFundRecipient);

        pay.setTreeNFT(address(nft));
        pay.setSettler(settler);
        nft.setMinter(address(pay));

        token.mint(poster, 1_000_000);
        vm.prank(poster);
        token.approve(address(pay), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _post(address who, uint256 amount) internal returns (uint256 jobId) {
        vm.prank(who);
        jobId = pay.postJob("render the sap forest site flythrough", amount);
    }

    function _fund(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(pay), type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // FLAW 1 - chain id
    // ---------------------------------------------------------------------

    /// @dev The spec declared `uint8 public chainId = 8453`. uint8 maxes out at
    ///      255, so a Base deployment carried a wrong or overflowed id, and it
    ///      was hardcoded, so Polygon reported Base's id.
    function test_ChainIdIsTheRealChainId() public view {
        assertEq(pay.chainId(), block.chainid);
        assertGt(pay.chainId(), 255, "a real chain id must not fit in a uint8");
    }

    function test_ChainIdIsNotHardcoded() public view {
        assertTrue(pay.chainId() != 8453 || block.chainid == 8453, "chain id must come from the chain");
    }

    // ---------------------------------------------------------------------
    // FLAW 6 - the zero sentinel collided with the first real job id
    // ---------------------------------------------------------------------

    /// @dev `jobCounter` started at 0, so job 0 was the first job -- but 0 is
    ///      the "no such job" sentinel. Job 0 could be posted and then never
    ///      read, completed, cancelled, extended or expired. Its bounty was
    ///      locked forever and the tree claim could never be minted.
    function test_FirstJobIdIsOneNeverZero() public {
        assertEq(pay.FIRST_JOB_ID(), 1);
        assertEq(pay.jobCounter(), 1, "a fresh contract must issue ids from 1");

        uint256 jobId = _post(poster, BOUNTY);
        assertEq(jobId, 1, "the first job must be id 1");
        assertEq(pay.jobCounter(), 2);
    }

    function test_JobZeroIsStillTheSentinel() public {
        vm.expectRevert(AgentPay.UnknownJob.selector);
        pay.job(0);
    }

    function test_JobOneIsReadableAndCompletable() public {
        uint256 jobId = _post(poster, BOUNTY);
        AgentPay.Job memory j = pay.job(jobId);
        assertEq(j.jobId, 1);
        assertEq(j.bounty, BOUNTY);

        vm.prank(poster);
        pay.completeJob(jobId, winner);
        assertTrue(pay.job(jobId).completed);
    }

    // ---------------------------------------------------------------------
    // FLAW 2 - ERC20 return values were ignored
    // ---------------------------------------------------------------------

    /// @dev USDT returns NO data. The spec called `transfer` and discarded the
    ///      result, so the winner could be marked paid while receiving nothing.
    function test_NoReturnTokenPaysTheWinner() public {
        NoReturnToken nr = new NoReturnToken();
        TreeNFT nrNft = new TreeNFT(address(this));
        AgentPay nrPay = new AgentPay(address(nr), treeFundRecipient);
        nrPay.setTreeNFT(address(nrNft));
        nrNft.setMinter(address(nrPay));

        nr.mint(poster, 1_000_000);
        vm.prank(poster);
        nr.approve(address(nrPay), type(uint256).max);

        vm.prank(poster);
        uint256 jobId = nrPay.postJob("usdt shaped job", BOUNTY);

        uint256 before = nr.balanceOf(winner);
        vm.prank(poster);
        nrPay.completeJob(jobId, winner);
        uint256 balanceAfter = nr.balanceOf(winner);

        assertEq(balanceAfter - before, (BOUNTY * 9_900) / 10_000, "the winner must actually be paid");
        assertEq(nrPay.treeFundAccrued(), (BOUNTY * 100) / 10_000);
    }

    /// @dev A token that returns false without reverting. The spec swallowed
    ///      that, so the job completed and the winner got nothing.
    function test_FalseReturnTokenRevertsAndLeavesTheJobOpen() public {
        FalseReturnToken fr = new FalseReturnToken();
        TreeNFT frNft = new TreeNFT(address(this));
        AgentPay frPay = new AgentPay(address(fr), treeFundRecipient);
        frPay.setTreeNFT(address(frNft));
        frNft.setMinter(address(frPay));

        fr.mint(poster, 1_000_000);
        vm.prank(poster);
        fr.approve(address(frPay), type(uint256).max);

        vm.prank(poster);
        uint256 jobId = frPay.postJob("lying token job", BOUNTY);

        vm.prank(poster);
        vm.expectRevert();
        frPay.completeJob(jobId, winner);

        assertFalse(frPay.job(jobId).completed, "the job must still be open");
        assertEq(frPay.treeFundAccrued(), 0, "nothing may be booked");
    }

    // ---------------------------------------------------------------------
    // FLAW 3 - the tree fund was transferred to the contract itself
    // ---------------------------------------------------------------------

    function test_TreeFundIsBookedAtExactlyOnePercent() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        pay.completeJob(jobId, winner);

        assertEq(pay.treeFundAccrued(), 1_000, "exactly 1% of the bounty");
        assertEq(pay.treeFundReleased(), 0);
        assertEq(token.balanceOf(winner), (BOUNTY * 9_900) / 10_000, "the winner gets 99%");
        assertEq(token.balanceOf(address(pay)), 1_000, "the contract holds the tree fund");
    }

    function test_OnlyTheSettlerMayReleaseTheTreeFund() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        pay.completeJob(jobId, winner);

        vm.prank(stranger);
        vm.expectRevert(AgentPay.NotSettler.selector);
        pay.releaseTreeFund(1_000);

        vm.prank(poster);
        vm.expectRevert(AgentPay.NotSettler.selector);
        pay.releaseTreeFund(1_000);
    }

    function test_TheSettlerReleasesOnlyToTheDesignatedRecipient() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        pay.completeJob(jobId, winner);

        vm.prank(settler);
        pay.releaseTreeFund(1_000);

        assertEq(token.balanceOf(treeFundRecipient), 1_000);
        assertEq(pay.treeFundAccrued(), 0);
        assertEq(pay.treeFundReleased(), 1_000);
    }

    function test_TheRecipientMaySweepItself() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        pay.completeJob(jobId, winner);

        vm.prank(treeFundRecipient);
        pay.sweepTreeFund(1_000);

        assertEq(token.balanceOf(treeFundRecipient), 1_000);
        assertEq(pay.treeFundAccrued(), 0);
    }

    function test_OverReleasingIsRejected() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        pay.completeJob(jobId, winner);

        vm.prank(settler);
        vm.expectRevert(AgentPay.InsufficientTreeFund.selector);
        pay.releaseTreeFund(1_001);
    }

    // ---------------------------------------------------------------------
    // FLAW 4 - fee-on-transfer tokens broke the books
    // ---------------------------------------------------------------------

    /// @dev $ASIMOV itself carries a 3% Token-2022 transfer fee, so this is
    ///      not hypothetical. The spec recorded the REQUESTED bounty, which
    ///      left the contract insolvent: completeJob would revert or overpay.
    function test_FeeOnTransferRecordsTheAmountActuallyReceived() public {
        FeeOnTransferToken ft = new FeeOnTransferToken(); // 3%
        TreeNFT ftNft = new TreeNFT(address(this));
        AgentPay ftPay = new AgentPay(address(ft), treeFundRecipient);
        ftPay.setTreeNFT(address(ftNft));
        ftNft.setMinter(address(ftPay));

        ft.mint(poster, 1_000_000);
        vm.prank(poster);
        ft.approve(address(ftPay), type(uint256).max);

        vm.prank(poster);
        uint256 jobId = ftPay.postJob("fee on transfer job", 100_000);

        assertEq(ftPay.job(jobId).bounty, 97_000, "the ACTUAL received amount is recorded");

        vm.prank(poster);
        ftPay.completeJob(jobId, winner);

        assertEq(ftPay.treeFundAccrued(), 970, "1% of what actually arrived");

        uint256 expectedWinner = (97_000 * 9_900) / 10_000; // 96_030
        uint256 feeOnPayout = (expectedWinner * 300) / 10_000; // 2_880
        assertEq(ft.balanceOf(winner), expectedWinner - feeOnPayout);

        // The contract must always still hold at least the booked tree fund.
        assertGe(ftPay.totalHeld(), ftPay.treeFundAccrued());
    }

    // ---------------------------------------------------------------------
    // FLAW 5 - escrowed funds could be locked forever
    // ---------------------------------------------------------------------

    function test_ThePosterMayCancelAndIsRefundedInFull() public {
        uint256 jobId = _post(poster, BOUNTY);
        uint256 before = token.balanceOf(poster);

        vm.prank(poster);
        pay.cancelJob(jobId);

        assertEq(token.balanceOf(poster), before + BOUNTY, "the full bounty comes back");
        assertTrue(pay.job(jobId).cancelled);
        assertEq(pay.totalHeld(), 0);
    }

    function test_StrangersMayNotCancel() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(stranger);
        vm.expectRevert(AgentPay.NotPoster.selector);
        pay.cancelJob(jobId);
    }

    function test_AnyoneMayExpireAnOverdueJobAndThePosterIsRefunded() public {
        uint256 jobId = _post(poster, BOUNTY);
        uint256 before = token.balanceOf(poster);

        vm.warp(block.timestamp + pay.DEFAULT_JOB_TTL() + 1);

        vm.prank(stranger); // deliberately not the poster
        pay.expireJob(jobId);

        assertEq(token.balanceOf(poster), before + BOUNTY);
        assertTrue(pay.job(jobId).cancelled);
        assertEq(pay.totalHeld(), 0);
    }

    function test_ExpiringBeforeTheDeadlineIsRejected() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(stranger);
        vm.expectRevert(AgentPay.JobNotOpen.selector);
        pay.expireJob(jobId);
    }

    function test_TheZeroAddressMayNotWin() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(poster);
        vm.expectRevert(AgentPay.ZeroAddress.selector);
        pay.completeJob(jobId, address(0));
    }

    function test_ThePromptIsBounded() public {
        string memory longPrompt = new string(1_025);
        vm.prank(poster);
        vm.expectRevert(AgentPay.PromptTooLong.selector);
        pay.postJob(longPrompt, BOUNTY);
    }

    function test_ZeroBountyIsRejected() public {
        vm.prank(poster);
        vm.expectRevert(AgentPay.ZeroBounty.selector);
        pay.postJob("free work?", 0);
    }

    function test_OnlyThePosterMayComplete() public {
        uint256 jobId = _post(poster, BOUNTY);
        vm.prank(stranger);
        vm.expectRevert(AgentPay.NotPoster.selector);
        pay.completeJob(jobId, winner);
    }

    function test_ThePosterMayExtendTheDeadline() public {
        uint256 jobId = _post(poster, BOUNTY);
        uint64 original = pay.job(jobId).deadline;
        uint64 extended = original + 1 days;

        vm.prank(poster);
        pay.extendJob(jobId, extended);

        assertEq(pay.job(jobId).deadline, extended);
    }

    // ---------------------------------------------------------------------
    // Core flow
    // ---------------------------------------------------------------------

    function test_TheFullHappyPath() public {
        uint256 jobId = _post(poster, BOUNTY);

        vm.prank(poster);
        pay.completeJob(jobId, winner);

        assertTrue(pay.job(jobId).completed);
        assertEq(pay.job(jobId).selectedWinner, winner);
        assertEq(token.balanceOf(winner), 99_000);
        assertEq(pay.treeFundAccrued(), 1_000);

        assertEq(nft.tokenIdForJob(jobId), 1);
        assertEq(nft.totalMinted(), 1);
        assertEq(nft.ownerOf(1), winner);
        assertEq(nft.record(1).jobId, jobId);
    }

    function test_JobIdsAreSequential() public {
        uint256 a = _post(poster, BOUNTY);
        uint256 b = _post(poster, BOUNTY);
        assertEq(a, 1);
        assertEq(b, 2);
    }

    // ---------------------------------------------------------------------
    // Nothing moves
    // ---------------------------------------------------------------------

    /// @dev The treasury rule, enforced on-chain: there is no route from the
    ///      contract that can move escrowed user funds to an arbitrary
    ///      address. The only outbound paths are the winner payout, the
    ///      poster refund and the tree-fund release -- and the last one is
    ///      bound by `treeFundAccrued` so it can never reach user escrow.
    function test_NoPayoutOrWithdrawRouteExists() public {
        bytes[] memory payloads = new bytes[](6);
        payloads[0] = abi.encodeWithSignature("payout(address,uint256)", address(this), 1);
        payloads[1] = abi.encodeWithSignature("withdraw(uint256)", 1);
        payloads[2] = abi.encodeWithSignature("transfer(address,uint256)", address(this), 1);
        payloads[3] = abi.encodeWithSignature("send(address,uint256)", address(this), 1);
        payloads[4] = abi.encodeWithSignature("settleToAccount(address,uint256)", address(this), 1);
        payloads[5] = abi.encodeWithSignature("move(address,uint256)", address(this), 1);

        for (uint256 i = 0; i < payloads.length; i++) {
            (bool ok,) = address(pay).call(payloads[i]);
            assertFalse(ok, "an unrestricted movement route must not exist");
        }
    }

    /// @dev The tree fund can never be over-released into open-job escrow.
    function test_TheTreeFundReleaseCannotReachUserEscrow() public {
        uint256 jobId = _post(poster, BOUNTY);

        // No tree fund has accrued, so nothing may be released.
        vm.prank(settler);
        vm.expectRevert(AgentPay.InsufficientTreeFund.selector);
        pay.releaseTreeFund(1);

        // The open job's escrow is untouched and still belongs to the poster.
        assertEq(pay.totalHeld(), BOUNTY);
        assertEq(pay.escrowedBalance(), BOUNTY);

        vm.prank(poster);
        pay.cancelJob(jobId);
    }
}
