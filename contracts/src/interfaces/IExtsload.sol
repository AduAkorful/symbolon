// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IExtsload
/// @notice Raw storage reads, so periphery lenses can serve every view without the core contract carrying getters
/// @dev Same shape as Uniswap v4's `IExtsload`
interface IExtsload {
    /// @notice Reads one storage slot
    function extsload(bytes32 slot) external view returns (bytes32 value);

    /// @notice Reads `nSlots` consecutive slots starting at `startSlot`
    function extsload(bytes32 startSlot, uint256 nSlots) external view returns (bytes32[] memory values);

    /// @notice Reads an arbitrary list of slots
    function extsload(bytes32[] calldata slots) external view returns (bytes32[] memory values);
}
