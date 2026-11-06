// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title TreeNFT
 * @notice The on-chain receipt for a tree that has been paid for and planted.
 *
 *         Every TreeNFT represents ONE real tree, funded by the 1% tree fund
 *         that AgentPay accrues from every job. The NFT is the recipient's
 *         proof that the fee was collected, the planting was paid for, and
 *         the Treegens Proof-of-Tree reference is recorded on-chain.
 *
 *         This contract never custodies user funds. It only records that a
 *         tree claim exists and who it belongs to.
 *
 * @dev Roles
 *      - owner    : administers minter/verifier. Cannot move funds.
 *      - minter   : the AgentPay contract. The only address that can mint.
 *      - verifier : the Treegens-side verifier who confirms planting.
 *
 *      Token ids are a monotonic counter, NOT a cast of the winner's address.
 *      (Flaw fix #7: the spec derived the token id from `uint160(to)`, which
 *      collides whenever the same address wins two jobs and silently
 *      overwrites the first tree's record.)
 */
contract TreeNFT is ERC721, Ownable {
    using Strings for uint256;

    /// @notice Per-token provenance.
    struct TreeRecord {
        uint256 jobId; // AgentPay job that funded this tree
        address winner; // agent that earned the tree
        string treegensRef; // Treegens Proof-of-Tree reference
        uint64 mintedAt; // unix seconds
        bool planted; // set once the verifier confirms planting
        bool burned; // set if the claim is burned
    }

    uint256 private _nextTokenId;
    mapping(uint256 => TreeRecord) private _records;
    mapping(uint256 => uint256) private _jobToToken; // jobId => tokenId

    address public minter;
    address public verifier;

    event TreeMinted(uint256 indexed tokenId, uint256 indexed jobId, address indexed winner, string treegensRef);
    event TreePlanted(uint256 indexed tokenId, string treegensRef);
    event TreeBurned(uint256 indexed tokenId);
    event MinterUpdated(address indexed minter);
    event VerifierUpdated(address indexed verifier);

    error NotMinter();
    error NotVerifier();
    error NotAuthorized();
    error JobIdZero();
    error JobAlreadyMinted();
    error AlreadyPlanted();
    error NonexistentToken();
    error ZeroAddress();
    error ZeroAmount();

    constructor(address initialVerifier) ERC721("SHADDAI Tree", "sTREE") Ownable(msg.sender) {
        _nextTokenId = 1; // ids start at 1; 0 means "not minted"
        if (initialVerifier != address(0)) {
            verifier = initialVerifier;
        }
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setMinter(address newMinter) external onlyOwner {
        if (newMinter == address(0)) revert ZeroAddress();
        minter = newMinter;
        emit MinterUpdated(newMinter);
    }

    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        verifier = newVerifier;
        emit VerifierUpdated(newVerifier);
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    /**
     * @notice Mint the tree claim for a completed job.
     * @dev Only the configured AgentPay contract may call this.
     */
    function mintForJob(address to, uint256 jobId, string calldata treegensRef)
        external
        returns (uint256 tokenId)
    {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        if (jobId == 0) revert JobIdZero();
        if (_jobToToken[jobId] != 0) revert JobAlreadyMinted();

        tokenId = _nextTokenId++;
        _jobToToken[jobId] = tokenId;
        _records[tokenId] = TreeRecord({
            jobId: jobId,
            winner: to,
            treegensRef: treegensRef,
            mintedAt: uint64(block.timestamp),
            planted: false,
            burned: false
        });

        _safeMint(to, tokenId);
        emit TreeMinted(tokenId, jobId, to, treegensRef);
    }

    /// @notice The token id minted for a given job (0 if none).
    function tokenIdForJob(uint256 jobId) external view returns (uint256) {
        return _jobToToken[jobId];
    }

    /// @notice Full provenance for a token.
    function record(uint256 tokenId) external view returns (TreeRecord memory) {
        if (_records[tokenId].jobId == 0) revert NonexistentToken();
        return _records[tokenId];
    }

    /// @notice Total trees minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    // ---------------------------------------------------------------------
    // Verification
    // ---------------------------------------------------------------------

    /**
     * @notice Confirm that the tree behind a token was actually planted.
     * @dev Callable by the Treegens verifier or the contract owner. This is
     *      the on-chain half of Treegens Proof-of-Tree: the claim exists
     *      before planting is confirmed, and the confirmation is public.
     */
    function markPlanted(uint256 tokenId, string calldata treegensRef) external {
        if (msg.sender != verifier && msg.sender != owner()) revert NotAuthorized();
        TreeRecord storage r = _records[tokenId];
        if (r.jobId == 0) revert NonexistentToken();
        if (r.burned) revert NonexistentToken();
        if (r.planted) revert AlreadyPlanted();
        r.planted = true;
        if (bytes(treegensRef).length > 0) {
            r.treegensRef = treegensRef;
        }
        emit TreePlanted(tokenId, r.treegensRef);
    }

    /// @notice Burn a claim (e.g. the tree was destroyed or the claim refunded).
    function burn(uint256 tokenId) external {
        TreeRecord storage r = _records[tokenId];
        if (r.jobId == 0) revert NonexistentToken();
        if (msg.sender != owner() && msg.sender != verifier) revert NotAuthorized();
        if (r.burned) revert NonexistentToken();
        r.burned = true;
        _burn(tokenId);
        emit TreeBurned(tokenId);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    /**
     * @notice On-chain metadata. No IPFS, no oracle, no host to go down.
     * @dev Returns a minimal JSON document describing the tree claim.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        TreeRecord storage r = _records[tokenId];
        if (r.jobId == 0) revert NonexistentToken();

        // solhint-disable-next-line no-complex-fallback
        return string.concat(
            "{\"name\":\"SHADDAI Tree #",
            tokenId.toString(),
            "\",\"description\":\"A real tree, paid for and planted through the S.A.P. green-initiative treasury.\",\"attributes\":[{\"trait_type\":\"jobId\",\"value\":",
            r.jobId.toString(),
            "},{\"trait_type\":\"winner\",\"value\":\"",
            _addressToString(r.winner),
            "\"},{\"trait_type\":\"treegensProofOfTree\",\"value\":\"",
            _escapeJson(r.treegensRef),
            "\"},{\"trait_type\":\"planted\",\"value\":",
            r.planted ? "true" : "false",
            "},{\"trait_type\":\"mintedAt\",\"value\":",
            _uintToString(r.mintedAt),
            "}]}"
        );
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _uintToString(uint256 value) private pure returns (string memory) {
        return Strings.toString(value);
    }

    function _addressToString(address value) private pure returns (string memory) {
        return Strings.toHexString(uint160(value), 20);
    }

    /// @dev Minimal JSON string escaping for the Treegens reference.
    function _escapeJson(string memory value) private pure returns (string memory) {
        bytes memory raw = bytes(value);
        bytes memory out = new bytes(raw.length * 2);
        uint256 j = 0;
        for (uint256 i = 0; i < raw.length; i++) {
            bytes1 c = raw[i];
            if (c == '"' || c == "\\") {
                out[j++] = "\\";
                out[j++] = c;
            } else if (uint8(c) < 0x20) {
                out[j++] = " ";
            } else {
                out[j++] = c;
            }
        }
        // Trim to the actual written length. `mstore(out, j)` writes the
        // length slot of the bytes array, which is exactly the truncation.
        assembly {
            mstore(out, j)
        }
        return string(out);
    }
}
