// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IInvoiceLedger} from "../src/interfaces/IInvoiceLedger.sol";
import {IReleaseRegistry} from "../src/interfaces/IReleaseRegistry.sol";
import {IUsycTeller} from "../src/interfaces/IUsycTeller.sol";

import {InvoiceLedger} from "../src/InvoiceLedger.sol";
import {ReleaseRegistry} from "../src/ReleaseRegistry.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultLens} from "../src/periphery/VaultLens.sol";

interface ITokenMessengerV2View {
    function localMessageTransmitter() external view returns (address);
}

interface IMessageTransmitterV2View {
    function localDomain() external view returns (uint32);
}

/// @notice Deploys Symbolon's core and periphery to the current chain and writes `deployments/<chainId>.json`.
/// External addresses come from `deployments/external/<chainId>.json` and are re-checked onchain before anything
/// is broadcast.
/// @dev forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --verify \
///      --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
contract Deploy is Script {
    uint64 internal constant FIRST_RELEASE = 1;
    /// @notice Notes for the Vault code this script deploys; on a fresh chain it is that registry's release 1
    string internal constant RELEASE_NOTES = "releases/vault-v2.md";

    struct External {
        uint32 cctpDomain;
        address tokenMessenger;
        address messageTransmitter;
        address usdc;
        address eurc;
        uint8 tokenDecimals;
        address usycTeller;
        address usyc;
    }

    struct Deployment {
        InvoiceLedger ledger;
        ReleaseRegistry registry;
        SymbolonVault implementation;
        VaultFactory factory;
        VaultLens lens;
    }

    error ExternalMismatch(string what);
    error DeploymentMismatch(string what);

    function run() external returns (Deployment memory d) {
        uint256 key = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(key);
        address releaseOwner = vm.envOr("RELEASE_OWNER", deployer);

        External memory ext = loadExternal(block.chainid);
        checkExternal(ext);
        // file access is scoped by fs_permissions in foundry.toml
        // forge-lint: disable-next-line(unsafe-cheatcode)
        bytes32 notesHash = keccak256(bytes(vm.readFile(RELEASE_NOTES)));
        // log scans start here; the broadcast lands at or after this block, so nothing is missed
        uint256 startBlock = block.number;

        vm.startBroadcast(key);
        d = deploy(ext, releaseOwner, deployer, notesHash);
        vm.stopBroadcast();

        checkDeployment(d, ext, releaseOwner);
        // a dry run's addresses don't exist onchain, so only a real broadcast writes the registry
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _writeRegistry(d, ext, deployer, releaseOwner, notesHash, startBlock);
        }
    }

    /// @notice Deploys every contract in dependency order and publishes release 1 if `publisher` owns the registry
    function deploy(External memory ext, address releaseOwner, address publisher, bytes32 notesHash)
        public
        returns (Deployment memory d)
    {
        d.ledger = new InvoiceLedger(ext.tokenMessenger, ext.cctpDomain);
        d.registry = new ReleaseRegistry(releaseOwner);
        d.implementation = new SymbolonVault(
            IInvoiceLedger(address(d.ledger)), IReleaseRegistry(address(d.registry)), IUsycTeller(ext.usycTeller)
        );
        d.factory = new VaultFactory(address(d.implementation));
        d.lens = new VaultLens();
        if (releaseOwner == publisher) d.registry.publish(address(d.implementation), FIRST_RELEASE, notesHash);
    }

    function loadExternal(uint256 chainId) public view returns (External memory ext) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(string.concat("deployments/external/", vm.toString(chainId), ".json"));
        if (vm.parseJsonUint(json, ".chainId") != chainId) revert ExternalMismatch("chainId");
        ext.cctpDomain = uint32(vm.parseJsonUint(json, ".cctpDomain"));
        ext.tokenMessenger = vm.parseJsonAddress(json, ".tokenMessengerV2");
        ext.messageTransmitter = vm.parseJsonAddress(json, ".messageTransmitterV2");
        ext.usdc = vm.parseJsonAddress(json, ".usdc");
        ext.eurc = vm.parseJsonAddress(json, ".eurc");
        ext.tokenDecimals = uint8(vm.parseJsonUint(json, ".tokenDecimals"));
        // chains without USYC leave these out; the Vault's reserve then stays off
        ext.usycTeller = vm.keyExistsJson(json, ".usycTeller") ? vm.parseJsonAddress(json, ".usycTeller") : address(0);
        ext.usyc = vm.keyExistsJson(json, ".usyc") ? vm.parseJsonAddress(json, ".usyc") : address(0);
    }

    /// @notice Refuses to deploy against external contracts that don't look like the configured ones
    function checkExternal(External memory ext) public view {
        if (ext.tokenMessenger.code.length == 0) revert ExternalMismatch("tokenMessenger has no code");
        address transmitter = ITokenMessengerV2View(ext.tokenMessenger).localMessageTransmitter();
        if (transmitter != ext.messageTransmitter) revert ExternalMismatch("messageTransmitter");
        if (IMessageTransmitterV2View(transmitter).localDomain() != ext.cctpDomain) revert ExternalMismatch("domain");
        if (IERC20Metadata(ext.usdc).decimals() != ext.tokenDecimals) revert ExternalMismatch("usdc decimals");
        if (IERC20Metadata(ext.eurc).decimals() != ext.tokenDecimals) revert ExternalMismatch("eurc decimals");
        if (ext.usycTeller != address(0)) {
            if (IUsycTeller(ext.usycTeller).asset() != ext.usdc) revert ExternalMismatch("usyc teller asset");
            if (IUsycTeller(ext.usycTeller).share() != ext.usyc) revert ExternalMismatch("usyc teller share");
            if (IERC20Metadata(ext.usyc).decimals() != ext.tokenDecimals) revert ExternalMismatch("usyc decimals");
        }
    }

    /// @notice Checks every link between the deployed contracts
    function checkDeployment(Deployment memory d, External memory ext, address releaseOwner) public view {
        if (address(d.ledger.tokenMessenger()) != ext.tokenMessenger) revert DeploymentMismatch("ledger messenger");
        if (d.ledger.localDomain() != ext.cctpDomain) revert DeploymentMismatch("ledger domain");
        if (address(d.implementation.ledger()) != address(d.ledger)) revert DeploymentMismatch("vault ledger");
        if (address(d.implementation.releaseRegistry()) != address(d.registry)) revert DeploymentMismatch("registry");
        if (d.factory.vaultImplementation() != address(d.implementation)) revert DeploymentMismatch("factory");
        if (d.registry.owner() != releaseOwner) revert DeploymentMismatch("registry owner");
        if (address(d.implementation.usycTeller()) != ext.usycTeller) revert DeploymentMismatch("usyc teller");
        if (address(d.lens).code.length == 0) revert DeploymentMismatch("lens");
    }

    function _writeRegistry(
        Deployment memory d,
        External memory ext,
        address deployer,
        address releaseOwner,
        bytes32 notesHash,
        uint256 startBlock
    ) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "InvoiceLedger", address(d.ledger));
        vm.serializeAddress(c, "ReleaseRegistry", address(d.registry));
        vm.serializeAddress(c, "SymbolonVaultImplementation", address(d.implementation));
        vm.serializeAddress(c, "VaultFactory", address(d.factory));
        string memory contracts = vm.serializeAddress(c, "VaultLens", address(d.lens));

        string memory e = "external";
        vm.serializeAddress(e, "tokenMessengerV2", ext.tokenMessenger);
        vm.serializeAddress(e, "messageTransmitterV2", ext.messageTransmitter);
        vm.serializeAddress(e, "usdc", ext.usdc);
        vm.serializeAddress(e, "usycTeller", ext.usycTeller);
        vm.serializeAddress(e, "usyc", ext.usyc);
        string memory externals = vm.serializeAddress(e, "eurc", ext.eurc);

        string memory r = "release";
        vm.serializeAddress(r, "owner", releaseOwner);
        // the script publishes release 1 only when the deployer owns the registry (see `deploy`)
        vm.serializeUint(r, "version", releaseOwner == deployer ? FIRST_RELEASE : 0);
        string memory release = vm.serializeBytes32(r, "notesHash", notesHash);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "cctpDomain", ext.cctpDomain);
        vm.serializeUint(root, "startBlock", startBlock);
        vm.serializeAddress(root, "deployer", deployer);
        vm.serializeString(root, "compiler", "solc 0.8.36, via_ir, optimizer 200 runs, evm prague");
        vm.serializeString(root, "contracts", contracts);
        vm.serializeString(root, "external", externals);
        string memory out = vm.serializeString(root, "release", release);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
