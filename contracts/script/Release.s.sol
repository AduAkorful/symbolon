// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {IInvoiceLedger} from "../src/interfaces/IInvoiceLedger.sol";
import {IReleaseRegistry} from "../src/interfaces/IReleaseRegistry.sol";
import {IUsycTeller} from "../src/interfaces/IUsycTeller.sol";

import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultLens} from "../src/periphery/VaultLens.sol";
import {Deploy} from "./Deploy.s.sol";

/// @notice Ships a new Vault release into an existing deployment: a new implementation (built against the same ledger
/// and registry), a factory for new Vaults on it, a lens that reads it, and a published release if the deployer owns
/// the registry. Existing Vaults are untouched: each owner upgrades on their own schedule.
/// @dev forge script script/Release.s.sol --rpc-url arc_testnet --broadcast --slow --verify \
///      --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
contract Release is Script {
    struct Shipped {
        SymbolonVault implementation;
        VaultFactory factory;
        VaultLens lens;
        uint64 version;
    }

    error ReleaseMismatch(string what);

    /// @notice Writes `deployments/releases/<chainId>-v<version>.json` and points the registry's current contracts at it
    function _record(string memory path, Shipped memory r, bytes32 notesHash, bool published, uint256 startBlock)
        internal
    {
        string memory k = "release";
        vm.serializeUint(k, "version", r.version);
        vm.serializeAddress(k, "SymbolonVaultImplementation", address(r.implementation));
        vm.serializeAddress(k, "VaultFactory", address(r.factory));
        vm.serializeAddress(k, "VaultLens", address(r.lens));
        vm.serializeBytes32(k, "notesHash", notesHash);
        vm.serializeBool(k, "published", published);
        string memory entry = vm.serializeUint(k, "startBlock", startBlock);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(
            entry,
            string.concat("deployments/releases/", vm.toString(block.chainid), "-v", vm.toString(r.version), ".json")
        );

        // the current contracts are the ones new Vaults and the app use; older releases stay in deployments/releases
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(vm.toString(address(r.implementation)), path, ".contracts.SymbolonVaultImplementation");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(vm.toString(address(r.factory)), path, ".contracts.VaultFactory");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(vm.toString(address(r.lens)), path, ".contracts.VaultLens");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(vm.toString(uint256(r.version)), path, ".release.version");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(vm.toString(notesHash), path, ".release.notesHash");
    }

    function run() external returns (Shipped memory r) {
        uint256 key = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(key);
        string memory notesPath = vm.envString("RELEASE_NOTES");
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory registryJson = vm.readFile(path);
        IInvoiceLedger ledger = IInvoiceLedger(vm.parseJsonAddress(registryJson, ".contracts.InvoiceLedger"));
        ReleaseRegistry releases = ReleaseRegistry(vm.parseJsonAddress(registryJson, ".contracts.ReleaseRegistry"));

        Deploy deploy = new Deploy();
        Deploy.External memory ext = deploy.loadExternal(block.chainid);
        deploy.checkExternal(ext);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        bytes32 notesHash = keccak256(bytes(vm.readFile(notesPath)));
        (, uint64 latestVersion) = releases.latest();
        r.version = latestVersion + 1;
        uint256 startBlock = block.number;

        vm.startBroadcast(key);
        r.implementation = new SymbolonVault(ledger, IReleaseRegistry(address(releases)), IUsycTeller(ext.usycTeller));
        r.factory = new VaultFactory(address(r.implementation));
        r.lens = new VaultLens();
        if (releases.owner() == deployer) releases.publish(address(r.implementation), r.version, notesHash);
        vm.stopBroadcast();

        if (address(r.implementation.ledger()) != address(ledger)) revert ReleaseMismatch("ledger");
        if (address(r.implementation.usycTeller()) != ext.usycTeller) revert ReleaseMismatch("usyc teller");
        if (r.factory.vaultImplementation() != address(r.implementation)) revert ReleaseMismatch("factory");

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _record(path, r, notesHash, releases.owner() == deployer, startBlock);
        }
    }
}
