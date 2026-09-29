// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ISymbolonVault} from "../interfaces/ISymbolonVault.sol";

/// @notice All state of a SymbolonVault, in one ERC-7201 namespace so upgrades can never collide with it.
/// Only ever append fields.
/// @custom:storage-location erc7201:symbolon.storage.SymbolonVault
struct VaultStorage {
    mapping(address seal => ISymbolonVault.Payee) payees;
    mapping(bytes32 budget => ISymbolonVault.Budget) budgets;
    mapping(bytes32 poRef => ISymbolonVault.PurchaseOrder) purchaseOrders;
    mapping(bytes32 fingerprint => bool) deliveryConfirmed;
    mapping(address approver => mapping(bytes32 budget => bool)) approvers;
    mapping(address approver => uint256 budgets) approverBudgetCount;
    mapping(address account => bool) isRequester;
    mapping(address token => bool) isSupportedToken;
    mapping(bytes32 changeId => uint64 eta) queuedChanges;
    mapping(address implementation => uint64 readyAt) scheduledUpgrades;
    ISymbolonVault.Policy policy;
    address steward;
    address screener;
    bool paused;
    uint8 accountingDecimals;
    bool autoUpdate;
    // set only for the duration of `applyRelease`, so `_authorizeUpgrade` can tell that path apart
    bool applyingRelease;
    // release 2
    ISymbolonVault.ReservePolicy reserve;
}

/// @title VaultStorageLib
/// @notice Locates the Vault's namespaced storage
library VaultStorageLib {
    // keccak256(abi.encode(uint256(keccak256("symbolon.storage.SymbolonVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant SLOT = 0x8c3a65422d204b878dcfcd37b62d14f92d1c4186f096d97c7671c3a1b01b2400;

    function load() internal pure returns (VaultStorage storage $) {
        assembly ("memory-safe") {
            // ERC-7201 namespaced storage: the slot is a compile-time constant, so this only sets a pointer
            $.slot := SLOT
        }
    }
}
