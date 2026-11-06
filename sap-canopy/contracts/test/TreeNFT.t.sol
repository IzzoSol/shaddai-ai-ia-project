// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TreeNFT} from "../src/TreeNFT.sol";

/**
 * @title TreeNFT Foundry suite
 * @notice The Foundry equivalent of scripts/test.js, written to the same
 *         assertions.
 *
 *         Run with:
 *             forge install foundry-rs/forge-std --no-commit
 *             forge test -vvv
 */
contract TreeNFTTest is Test {
    TreeNFT nft;

    address minter = address(0x1111);
    address verifier = address(0x2222);
    address winner = address(0x3333);
    address stranger = address(0x4444);

    function setUp() public {
        nft = new TreeNFT(verifier);
        nft.setMinter(minter);
    }

    function _mint(address to, uint256 jobId) internal returns (uint256 tokenId) {
        vm.prank(minter);
        tokenId = nft.mintForJob(to, jobId, "");
    }

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    function test_OnlyTheMinterMayMint() public {
        vm.prank(stranger);
        vm.expectRevert(TreeNFT.NotMinter.selector);
        nft.mintForJob(winner, 1, "");
    }

    function test_TheZeroAddressMayNotReceiveAClaim() public {
        vm.prank(minter);
        vm.expectRevert(TreeNFT.ZeroAddress.selector);
        nft.mintForJob(address(0), 1, "");
    }

    function test_JobIdZeroIsRejected() public {
        // This is the same sentinel AgentPay used to collide with. See FLAW 6.
        vm.prank(minter);
        vm.expectRevert(TreeNFT.JobIdZero.selector);
        nft.mintForJob(winner, 0, "");
    }

    function test_OneJobMayOnlyMintOnce() public {
        _mint(winner, 7);
        vm.prank(minter);
        vm.expectRevert(TreeNFT.JobAlreadyMinted.selector);
        nft.mintForJob(winner, 7, "");
    }

    // ---------------------------------------------------------------------
    // Monotonic token ids -- the collision fix
    // ---------------------------------------------------------------------

    /// @dev The spec derived the token id from `uint256(uint160(to))`, so the
    ///      SAME address winning two jobs collided and silently overwrote the
    ///      first tree's record. Token ids are now a monotonic counter.
    function test_TheSameWinnerMayWinTwoJobsWithoutColliding() public {
        uint256 t1 = _mint(winner, 1);
        uint256 t2 = _mint(winner, 2);

        assertEq(t1, 1);
        assertEq(t2, 2);
        assertTrue(t1 != t2, "token ids must not collide");

        assertEq(nft.record(t1).jobId, 1, "the first record must still be intact");
        assertEq(nft.record(t2).jobId, 2);
        assertEq(nft.ownerOf(t1), winner);
        assertEq(nft.ownerOf(t2), winner);
    }

    function test_TokenIdsStartAtOne() public {
        assertEq(nft.totalMinted(), 0);
        assertEq(_mint(winner, 1), 1);
        assertEq(nft.totalMinted(), 1);
    }

    function test_TokenIdForJobIsZeroWhenNothingWasMinted() public view {
        assertEq(nft.tokenIdForJob(99), 0);
    }

    // ---------------------------------------------------------------------
    // Proof of Tree
    // ---------------------------------------------------------------------

    function test_TheVerifierMayConfirmPlanting() public {
        uint256 tokenId = _mint(winner, 1);

        vm.prank(verifier);
        nft.markPlanted(tokenId, "treegens-proof-of-tree-ref");

        TreeNFT.TreeRecord memory r = nft.record(tokenId);
        assertTrue(r.planted);
        assertEq(r.treegensRef, "treegens-proof-of-tree-ref");
    }

    function test_AStrangerMayNotConfirmPlanting() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(stranger);
        vm.expectRevert(TreeNFT.NotAuthorized.selector);
        nft.markPlanted(tokenId, "ref");
    }

    function test_PlantingCannotBeConfirmedTwice() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(verifier);
        nft.markPlanted(tokenId, "ref");

        vm.prank(verifier);
        vm.expectRevert(TreeNFT.AlreadyPlanted.selector);
        nft.markPlanted(tokenId, "ref");
    }

    function test_AnEmptyRefDoesNotOverwriteTheStoredOne() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(verifier);
        nft.markPlanted(tokenId, "the-real-ref");

        // A later confirmation with an empty ref must not erase the proof.
        vm.prank(verifier);
        vm.expectRevert(TreeNFT.AlreadyPlanted.selector);
        nft.markPlanted(tokenId, "");
    }

    // ---------------------------------------------------------------------
    // Burning
    // ---------------------------------------------------------------------

    function test_TheOwnerMayBurnAClaim() public {
        uint256 tokenId = _mint(winner, 1);
        nft.burn(tokenId); // the owner is this test contract

        assertTrue(nft.record(tokenId).burned);
        vm.expectRevert();
        nft.ownerOf(tokenId);
    }

    function test_AStrangerMayNotBurnAClaim() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(stranger);
        vm.expectRevert(TreeNFT.NotAuthorized.selector);
        nft.burn(tokenId);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    function test_TheTokenUriIsSelfContainedJson() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(verifier);
        nft.markPlanted(tokenId, "proof-ref");

        string memory uri = nft.tokenURI(tokenId);
        assertTrue(_contains(uri, "SHADDAI Tree #1"));
        assertTrue(_contains(uri, "treegensProofOfTree"));
        assertTrue(_contains(uri, "proof-ref"));
        assertTrue(_contains(uri, "\"planted\",\"value\":true"));
    }

    function test_TheTokenUriEscapesQuotes() public {
        uint256 tokenId = _mint(winner, 1);
        vm.prank(verifier);
        nft.markPlanted(tokenId, 'a"b\\c');

        string memory uri = nft.tokenURI(tokenId);
        assertTrue(_contains(uri, 'a\\"b\\\\c'), "quotes and backslashes must be escaped");
    }

    function test_MetadataForANonexistentTokenReverts() public {
        vm.expectRevert(TreeNFT.NonexistentToken.selector);
        nft.tokenURI(999);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
