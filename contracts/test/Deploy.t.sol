// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUsycTeller} from "./mocks/MockUsycTeller.sol";

contract FakeTransmitter {
    uint32 public localDomain;

    constructor(uint32 domain) {
        localDomain = domain;
    }
}

contract FakeMessenger {
    address public localMessageTransmitter;

    constructor(address transmitter) {
        localMessageTransmitter = transmitter;
    }
}

/// @notice Runs the deploy script's logic in-process and checks its guards and wiring
contract DeployTest is Test {
    uint32 internal constant DOMAIN = 26;
    uint256 internal constant ARC_TESTNET = 5_042_002;

    Deploy internal script;
    Deploy.External internal ext;

    function setUp() public {
        script = new Deploy();
        FakeTransmitter transmitter = new FakeTransmitter(DOMAIN);
        ext = Deploy.External({
            cctpDomain: DOMAIN,
            tokenMessenger: address(new FakeMessenger(address(transmitter))),
            messageTransmitter: address(transmitter),
            usdc: address(new MockERC20("USD Coin", "USDC", 6)),
            eurc: address(new MockERC20("Euro Coin", "EURC", 6)),
            tokenDecimals: 6,
            usycTeller: address(0),
            usyc: address(0)
        });
    }

    function test_loadExternal_readsTheVerifiedTestnetConfig() public view {
        Deploy.External memory loaded = script.loadExternal(ARC_TESTNET);
        assertEq(loaded.cctpDomain, DOMAIN);
        assertEq(loaded.tokenDecimals, 6);
        assertTrue(loaded.tokenMessenger != address(0) && loaded.usdc != address(0) && loaded.eurc != address(0));
        assertTrue(loaded.usycTeller != address(0) && loaded.usyc != address(0));
    }

    function test_checkExternal_acceptsMatchingContracts() public view {
        script.checkExternal(ext);
    }

    function test_checkExternal_rejectsWrongDomain() public {
        ext.cctpDomain = DOMAIN + 1;
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "domain"));
        script.checkExternal(ext);
    }

    function test_checkExternal_rejectsWrongTransmitter() public {
        ext.messageTransmitter = makeAddr("other");
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "messageTransmitter"));
        script.checkExternal(ext);
    }

    function test_checkExternal_rejectsMissingMessenger() public {
        ext.tokenMessenger = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "tokenMessenger has no code"));
        script.checkExternal(ext);
    }

    function test_checkExternal_rejectsWrongDecimals() public {
        ext.eurc = address(new MockERC20("Eighteen", "E18", 18));
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "eurc decimals"));
        script.checkExternal(ext);
    }

    function test_checkExternal_acceptsAMatchingUsycTeller() public {
        MockUsycTeller teller = new MockUsycTeller(MockERC20(ext.usdc));
        ext.usycTeller = address(teller);
        ext.usyc = address(teller.usycToken());
        script.checkExternal(ext);
        Deploy.Deployment memory d = script.deploy(ext, address(script), address(script), keccak256("notes"));
        script.checkDeployment(d, ext, address(script));
        assertEq(address(d.implementation.usycTeller()), address(teller));
    }

    function test_checkExternal_rejectsATellerForAnotherAsset() public {
        MockUsycTeller teller = new MockUsycTeller(MockERC20(ext.eurc));
        ext.usycTeller = address(teller);
        ext.usyc = address(teller.usycToken());
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "usyc teller asset"));
        script.checkExternal(ext);
    }

    function test_checkExternal_rejectsTheWrongUsycToken() public {
        MockUsycTeller teller = new MockUsycTeller(MockERC20(ext.usdc));
        ext.usycTeller = address(teller);
        ext.usyc = ext.eurc;
        vm.expectRevert(abi.encodeWithSelector(Deploy.ExternalMismatch.selector, "usyc teller share"));
        script.checkExternal(ext);
    }

    function test_deploy_wiresEverythingAndPublishesRelease1() public {
        Deploy.Deployment memory d = script.deploy(ext, address(script), address(script), keccak256("notes"));
        script.checkDeployment(d, ext, address(script));

        (address latest, uint64 version) = d.registry.latest();
        assertEq(latest, address(d.implementation));
        assertEq(version, 1);
        assertEq(d.registry.release(latest).notesHash, keccak256("notes"));

        // a Vault made by the deployed factory is readable through the deployed lens
        address[] memory tokens = new address[](1);
        tokens[0] = ext.usdc;
        ISymbolonVault.Policy memory policy;
        address vault = d.factory.createVault(address(this), address(0), policy, tokens, 6, false);
        assertTrue(d.factory.isVault(vault));
        assertEq(d.lens.getVaultState(vault).owner, address(this));
        assertTrue(d.lens.isSupportedToken(vault, ext.usdc));
        assertFalse(d.lens.autoUpdate(vault));
    }

    function test_deploy_skipsPublishingWhenSomeoneElseOwnsTheRegistry() public {
        address multisig = makeAddr("multisig");
        Deploy.Deployment memory d = script.deploy(ext, multisig, address(script), keccak256("notes"));
        script.checkDeployment(d, ext, multisig);
        (address latest, uint64 version) = d.registry.latest();
        assertEq(latest, address(0));
        assertEq(version, 0);
    }

    function test_checkDeployment_catchesAWrongOwner() public {
        Deploy.Deployment memory d = script.deploy(ext, address(script), address(script), keccak256("notes"));
        vm.expectRevert(abi.encodeWithSelector(Deploy.DeploymentMismatch.selector, "registry owner"));
        script.checkDeployment(d, ext, makeAddr("someoneElse"));
    }
}
