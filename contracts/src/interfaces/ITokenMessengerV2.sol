// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice The subset of Circle's CCTP V2 TokenMessenger that Symbolon calls
/// @dev Signature taken from developers.circle.com/cctp/references/contract-interfaces and checked against the
/// verified TokenMessengerV2 implementation on the Arc testnet explorer. The fee is deducted on the destination:
/// the recipient receives `amount - feeExecuted`, where `feeExecuted <= maxFee < amount`.
interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}
