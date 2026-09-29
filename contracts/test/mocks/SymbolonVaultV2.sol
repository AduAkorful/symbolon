// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IInvoiceLedger} from "../../src/interfaces/IInvoiceLedger.sol";
import {IReleaseRegistry} from "../../src/interfaces/IReleaseRegistry.sol";
import {IUsycTeller} from "../../src/interfaces/IUsycTeller.sol";
import {SymbolonVault} from "../../src/SymbolonVault.sol";

/// @notice A next Vault version, for upgrade tests
contract SymbolonVaultV2 is SymbolonVault {
    constructor(IInvoiceLedger ledger_, IReleaseRegistry registry_)
        SymbolonVault(ledger_, registry_, IUsycTeller(address(0)))
    {}

    function version() external pure returns (uint256) {
        return 2;
    }
}

/// @notice Not UUPS: an upgrade to it must be refused
contract NotUpgradeable {
    function version() external pure returns (uint256) {
        return 99;
    }
}
