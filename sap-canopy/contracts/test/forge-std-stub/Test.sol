// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function warp(uint256) external;
    function deal(address, uint256) external;
}

/// @dev A stub of forge-std's Test.sol, used ONLY to syntax- and
///      type-check the Foundry suites with solc on a machine where Foundry is
///      not installed. It is NOT a test runner -- the real assertions live in
///      scripts/test.js.
contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool) internal pure {}
    function assertTrue(bool, string memory) internal pure {}
    function assertFalse(bool) internal pure {}
    function assertFalse(bool, string memory) internal pure {}
    function assertEq(uint256, uint256) internal pure {}
    function assertEq(uint256, uint256, string memory) internal pure {}
    function assertEq(address, address) internal pure {}
    function assertEq(address, address, string memory) internal pure {}
    function assertEq(string memory, string memory) internal pure {}
    function assertEq(string memory, string memory, string memory) internal pure {}
    function assertEq(bytes32, bytes32) internal pure {}
    function assertGt(uint256, uint256) internal pure {}
    function assertGt(uint256, uint256, string memory) internal pure {}
    function assertGe(uint256, uint256) internal pure {}
    function assertGe(uint256, uint256, string memory) internal pure {}
    function assertLt(uint256, uint256) internal pure {}
    function assertLt(uint256, uint256, string memory) internal pure {}
    function assertLe(uint256, uint256) internal pure {}
    function assertLe(uint256, uint256, string memory) internal pure {}
    function assertNotEq(uint256, uint256) internal pure {}
    function assertNotEq(uint256, uint256, string memory) internal pure {}
}
