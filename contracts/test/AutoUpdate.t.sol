// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {VaultTest} from "./utils/VaultTest.sol";
import {Invoice} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {IReleaseRegistry} from "../src/interfaces/IReleaseRegistry.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";
import {SymbolonVaultV2} from "./mocks/SymbolonVaultV2.sol";

contract AutoUpdateTest is VaultTest {
    SymbolonVaultV2 internal v2;
    address internal keeper = makeAddr("keeper");

    function setUp() public override {
        super.setUp();
        v2 = new SymbolonVaultV2(ledger, registry);
    }

    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function _publishV2() internal {
        vm.prank(releaseKey);
        registry.publish(address(v2), 2, keccak256("v2 notes"));
    }

    function _enableAutoUpdate() internal {
        vm.startPrank(owner);
        vault.setAutoUpdate(true);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setAutoUpdate(true);
        vm.stopPrank();
        assertTrue(lens.autoUpdate(address(vault)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Default: manual
    // ---------------------------------------------------------------------------------------------------------------

    function test_default_isManual() public {
        assertFalse(lens.autoUpdate(address(vault)));
        _publishV2();

        vm.prank(keeper);
        vm.expectRevert(ISymbolonVault.AutoUpdateOff.selector);
        vault.scheduleRelease(address(v2));

        vm.prank(keeper);
        vm.expectRevert(ISymbolonVault.AutoUpdateOff.selector);
        vault.applyRelease(address(v2));

        // Symbolon's release key has no power over a manual Vault either
        vm.prank(releaseKey);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, releaseKey));
        vault.upgradeToAndCall(address(v2), "");
        assertEq(_implementationOf(address(vault)), address(implementation));
    }

    function test_setAutoUpdate_enablingIsDelayedDisablingIsImmediate() public {
        vm.prank(owner);
        vault.setAutoUpdate(true);
        assertFalse(lens.autoUpdate(address(vault)));

        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.setAutoUpdate(true);
        assertTrue(lens.autoUpdate(address(vault)));

        vm.prank(owner);
        vault.setAutoUpdate(false);
        assertFalse(lens.autoUpdate(address(vault)));
    }

    function test_setAutoUpdate_onlyOwner() public {
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, steward));
        vault.setAutoUpdate(true);
    }

    function test_createVault_canOptInAtCreation() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        SymbolonVault fresh = SymbolonVault(payable(factory.createVault(owner, steward, _policy(), tokens, 6, true)));
        assertTrue(lens.autoUpdate(address(fresh)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Opted in
    // ---------------------------------------------------------------------------------------------------------------

    function test_autoUpdate_publishedReleaseAppliesAfterDelayAndKeepsState() public {
        _enableAutoUpdate();
        _stewardPays(_invoice(500 * ONE_USDC), 500 * ONE_USDC);
        _publishV2();

        vm.prank(keeper);
        vault.scheduleRelease(address(v2));
        uint64 readyAt = uint64(block.timestamp + LOOSENING_DELAY);
        assertEq(lens.scheduledUpgrade(address(vault), address(v2)), readyAt);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotReady.selector, address(v2), readyAt));
        vault.applyRelease(address(v2));

        vm.warp(readyAt);
        vm.prank(keeper);
        vault.applyRelease(address(v2));

        assertEq(_implementationOf(address(vault)), address(v2));
        assertEq(SymbolonVaultV2(payable(address(vault))).version(), 2);
        assertEq(vault.owner(), owner);
        assertEq(lens.getPayee(address(vault), seal).paidCount, 1);
        assertTrue(lens.autoUpdate(address(vault)));

        Invoice memory next = _invoice(500 * ONE_USDC);
        next.invoiceNumberHash = keccak256("after-release");
        _stewardPays(next, 500 * ONE_USDC);
    }

    function test_autoUpdate_unpublishedCannotBeScheduled() public {
        _enableAutoUpdate();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ReleaseNotPublished.selector, address(v2)));
        vault.scheduleRelease(address(v2));
    }

    function test_autoUpdate_revokedAfterSchedulingCannotApply() public {
        _enableAutoUpdate();
        _publishV2();
        vm.prank(keeper);
        vault.scheduleRelease(address(v2));

        vm.prank(releaseKey);
        registry.revoke(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ReleaseNotPublished.selector, address(v2)));
        vault.applyRelease(address(v2));
    }

    function test_autoUpdate_ownerCanCancelPendingRelease() public {
        _enableAutoUpdate();
        _publishV2();
        vm.prank(keeper);
        vault.scheduleRelease(address(v2));

        vm.prank(owner);
        vault.cancelUpgrade(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotScheduled.selector, address(v2)));
        vault.applyRelease(address(v2));
    }

    function test_autoUpdate_switchingOffStopsPendingRelease() public {
        _enableAutoUpdate();
        _publishV2();
        vm.prank(keeper);
        vault.scheduleRelease(address(v2));

        vm.prank(owner);
        vault.setAutoUpdate(false);
        vm.warp(block.timestamp + LOOSENING_DELAY);

        vm.prank(keeper);
        vm.expectRevert(ISymbolonVault.AutoUpdateOff.selector);
        vault.applyRelease(address(v2));
    }

    function test_autoUpdate_cannotRescheduleToResetDelay() public {
        _enableAutoUpdate();
        _publishV2();
        vm.prank(keeper);
        vault.scheduleRelease(address(v2));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeAlreadyScheduled.selector, address(v2)));
        vault.scheduleRelease(address(v2));
    }

    function test_autoUpdate_nonOwnerStillCannotUpgradeDirectly() public {
        _enableAutoUpdate();
        _publishV2();
        vm.prank(keeper);
        vault.scheduleRelease(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, keeper));
        vault.upgradeToAndCall(address(v2), abi.encodeCall(SymbolonVaultV2.version, ()));
    }

    function test_autoUpdate_ownerManualPathStillWorksForAnyImplementation() public {
        // the owner can upgrade to something Symbolon never published; that is their call
        SymbolonVaultV2 custom = new SymbolonVaultV2(ledger, registry);
        vm.prank(owner);
        vault.scheduleUpgrade(address(custom));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.upgradeToAndCall(address(custom), "");
        assertEq(_implementationOf(address(vault)), address(custom));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Registry
    // ---------------------------------------------------------------------------------------------------------------

    function test_registry_onlyReleaseKeyPublishesAndRevokes() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        registry.publish(address(v2), 2, bytes32(0));

        _publishV2();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        registry.revoke(address(v2));
    }

    function test_registry_versionsIncreaseAndNeedCode() public {
        _publishV2();
        (address latestImpl, uint64 latestVersion) = registry.latest();
        assertEq(latestImpl, address(v2));
        assertEq(latestVersion, 2);
        assertTrue(registry.isPublished(address(v2)));
        assertEq(registry.release(address(v2)).notesHash, keccak256("v2 notes"));

        SymbolonVaultV2 v3 = new SymbolonVaultV2(ledger, registry);
        vm.startPrank(releaseKey);
        vm.expectRevert(abi.encodeWithSelector(IReleaseRegistry.VersionNotIncreasing.selector, 2, 2));
        registry.publish(address(v3), 2, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IReleaseRegistry.AlreadyPublished.selector, address(v2)));
        registry.publish(address(v2), 3, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IReleaseRegistry.NotAContract.selector, makeAddr("eoa")));
        registry.publish(makeAddr("eoa"), 3, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(IReleaseRegistry.UnknownRelease.selector, address(v3)));
        registry.revoke(address(v3));
        vm.stopPrank();
    }

    function test_registry_ownershipIsTwoStep() public {
        address multisig = makeAddr("multisig");
        vm.prank(releaseKey);
        registry.transferOwnership(multisig);
        assertEq(registry.owner(), releaseKey);
        vm.prank(multisig);
        registry.acceptOwnership();
        assertEq(registry.owner(), multisig);
    }
}
