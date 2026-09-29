// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice The Steward's decision anchors (packages/steward, TypeScript) must be provable with OpenZeppelin's
/// MerkleProof against the root a Vault emits in `DecisionsAnchored(root, count)`.
contract DecisionMerkleTest is Test {
    string internal constant VECTORS = "../packages/steward/vectors/merkle.json";
    uint256 internal constant TREES = 6;

    function test_decisionProofs_verifyWithOpenZeppelin() public view {
        // read-only, scoped to the vectors directory by fs_permissions
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(VECTORS);
        for (uint256 t; t < TREES; ++t) {
            string memory base = string.concat(".trees[", vm.toString(t), "]");
            bytes32 root = vm.parseJsonBytes32(json, string.concat(base, ".root"));
            bytes32[] memory decisions = vm.parseJsonBytes32Array(json, string.concat(base, ".decisions"));
            for (uint256 i; i < decisions.length; ++i) {
                bytes32[] memory proof = decisions.length == 1
                    ? new bytes32[](0)
                    : vm.parseJsonBytes32Array(json, string.concat(base, ".proofs[", vm.toString(i), "]"));
                assertTrue(MerkleProof.verify(proof, root, _leaf(decisions[i])), "genuine decision proves");
                assertFalse(MerkleProof.verify(proof, root, _leaf(keccak256(abi.encode(decisions[i])))), "forged fails");
            }
        }
    }

    /// @notice OpenZeppelin's standard leaf: double-hashed so a leaf can never be mistaken for an inner node
    function _leaf(bytes32 decisionHash) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(decisionHash))));
    }
}
