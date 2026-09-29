// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IExtsload} from "./interfaces/IExtsload.sol";

/// @title Extsload
/// @notice Exposes raw storage reads for periphery lenses
abstract contract Extsload is IExtsload {
    /// @inheritdoc IExtsload
    function extsload(bytes32 slot) external view returns (bytes32 value) {
        assembly ("memory-safe") {
            // read-only: returns the word at `slot`
            value := sload(slot)
        }
    }

    /// @inheritdoc IExtsload
    function extsload(bytes32 startSlot, uint256 nSlots) external view returns (bytes32[] memory values) {
        values = new bytes32[](nSlots);
        for (uint256 i; i < nSlots; ++i) {
            bytes32 slot = bytes32(uint256(startSlot) + i);
            bytes32 value;
            assembly ("memory-safe") {
                // read-only: consecutive words from `startSlot`
                value := sload(slot)
            }
            values[i] = value;
        }
    }

    /// @inheritdoc IExtsload
    function extsload(bytes32[] calldata slots) external view returns (bytes32[] memory values) {
        values = new bytes32[](slots.length);
        for (uint256 i; i < slots.length; ++i) {
            bytes32 slot = slots[i];
            bytes32 value;
            assembly ("memory-safe") {
                // read-only: the word at each requested slot
                value := sload(slot)
            }
            values[i] = value;
        }
    }
}
