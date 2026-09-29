// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Interfaces
import {ISymbolonVault} from "./interfaces/ISymbolonVault.sol";

// Contracts
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {SymbolonVault} from "./SymbolonVault.sol";

/// @title VaultFactory
/// @notice Deploys business Vaults as proxies of one implementation. Holds no privileges over the Vaults it creates:
/// each Vault's owner alone decides whether it is ever upgraded.
contract VaultFactory {
    address public immutable vaultImplementation;

    mapping(address vault => bool) public isVault;

    event VaultCreated(address indexed vault, address indexed owner, address indexed steward, address implementation);

    error ZeroAddress();

    constructor(address vaultImplementation_) {
        if (vaultImplementation_ == address(0)) revert ZeroAddress();
        vaultImplementation = vaultImplementation_;
    }

    /// @notice Creates and initializes a Vault for a business in one transaction
    /// @param owner The business owner
    /// @param steward The Steward's address, or zero to start without one
    /// @param policy Initial policy
    /// @param tokens Initially supported payment tokens
    /// @param accountingDecimals Decimals every policy amount is denominated in
    /// @param autoUpdate Whether the owner chose to follow Symbolon's published releases (default off in the app)
    function createVault(
        address owner,
        address steward,
        ISymbolonVault.Policy calldata policy,
        address[] calldata tokens,
        uint8 accountingDecimals,
        bool autoUpdate
    ) external returns (address vault) {
        bytes memory init = abi.encodeCall(
            SymbolonVault.initialize, (owner, steward, policy, tokens, accountingDecimals, autoUpdate)
        );
        vault = address(new ERC1967Proxy(vaultImplementation, init));
        isVault[vault] = true;
        emit VaultCreated(vault, owner, steward, vaultImplementation);
    }
}
