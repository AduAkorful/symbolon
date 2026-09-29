// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {VaultTest} from "./utils/VaultTest.sol";
import {Invoice} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";

import {SymbolonVaultV2, NotUpgradeable} from "./mocks/SymbolonVaultV2.sol";

contract VaultUpgradeTest is VaultTest {
    SymbolonVaultV2 internal v2;

    function setUp() public override {
        super.setUp();
        v2 = new SymbolonVaultV2(ledger, registry);
    }

    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function test_upgrade_ownerAfterDelayPreservesState() public {
        // build up state worth preserving
        Invoice memory inv = _invoice(500 * ONE_USDC);
        _stewardPays(inv, 500 * ONE_USDC);
        bytes32 design = keccak256("design");
        vm.prank(owner);
        vault.setBudget(design, 7_000 * ONE_USDC, 30 days);
        uint256 balanceBefore = usdc.balanceOf(address(vault));

        vm.prank(owner);
        vault.scheduleUpgrade(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.upgradeToAndCall(address(v2), "");

        assertEq(_implementationOf(address(vault)), address(v2));
        assertEq(SymbolonVaultV2(address(vault)).version(), 2);
        assertEq(vault.owner(), owner);
        assertEq(lens.steward(address(vault)), steward);
        assertEq(lens.screener(address(vault)), screener);
        assertTrue(lens.isApprover(address(vault), approver, OPERATING));
        assertTrue(lens.isRequester(address(vault), requester));
        assertTrue(lens.isSupportedToken(address(vault), address(usdc)));
        assertEq(lens.accountingDecimals(address(vault)), 6);
        assertEq(lens.getPayee(address(vault), seal).paidCount, 1);
        assertEq(lens.getPayee(address(vault), seal).payout, payout);
        assertEq(lens.getBudget(address(vault), design).cap, 7_000 * ONE_USDC);
        assertEq(lens.getPolicy(address(vault)).autoPayLimit, AUTO_PAY);
        assertEq(usdc.balanceOf(address(vault)), balanceBefore);
        assertEq(lens.scheduledUpgrade(address(vault), address(v2)), 0);

        // and it still pays under the same rules
        Invoice memory next = _invoice(500 * ONE_USDC);
        next.invoiceNumberHash = keccak256("after-upgrade");
        _stewardPays(next, 500 * ONE_USDC);
        assertEq(usdc.balanceOf(payout), 1_000 * ONE_USDC);
    }

    function test_upgrade_revertsWithoutSchedule() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotScheduled.selector, address(v2)));
        vault.upgradeToAndCall(address(v2), "");
    }

    function test_upgrade_revertsBeforeDelay() public {
        vm.prank(owner);
        vault.scheduleUpgrade(address(v2));
        uint64 readyAt = uint64(block.timestamp + LOOSENING_DELAY);
        vm.warp(readyAt - 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotReady.selector, address(v2), readyAt));
        vault.upgradeToAndCall(address(v2), "");
    }

    function test_upgrade_onlyOwnerCanScheduleOrUpgrade() public {
        vm.prank(owner);
        vault.scheduleUpgrade(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);

        address[3] memory others = [steward, approver, makeAddr("stranger")];
        for (uint256 i; i < others.length; ++i) {
            vm.startPrank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, others[i]));
            vault.scheduleUpgrade(address(v2));
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, others[i]));
            vault.upgradeToAndCall(address(v2), "");
            vm.stopPrank();
        }
        assertEq(_implementationOf(address(vault)), address(implementation));
    }

    function test_upgrade_factoryHasNoPower() public {
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(factory)));
        vault.scheduleUpgrade(address(v2));
    }

    function test_cancelUpgrade_blocksIt() public {
        vm.startPrank(owner);
        vault.scheduleUpgrade(address(v2));
        vault.cancelUpgrade(address(v2));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotScheduled.selector, address(v2)));
        vault.upgradeToAndCall(address(v2), "");
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UpgradeNotScheduled.selector, address(v2)));
        vault.cancelUpgrade(address(v2));
        vm.stopPrank();
    }

    function test_upgrade_refusesNonUupsImplementation() public {
        NotUpgradeable bad = new NotUpgradeable();
        vm.prank(owner);
        vault.scheduleUpgrade(address(bad));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(bad)));
        vault.upgradeToAndCall(address(bad), "");
    }

    function test_upgrade_delayFollowsPolicyAtScheduleTime() public {
        // a longer delay is a tightening change and applies immediately
        ISymbolonVault.Policy memory pol = _policy();
        pol.looseningDelay = 7 days;
        vm.startPrank(owner);
        vault.setPolicy(pol);
        vault.scheduleUpgrade(address(v2));
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert();
        vault.upgradeToAndCall(address(v2), "");
        vm.warp(block.timestamp + 1);
        vault.upgradeToAndCall(address(v2), "");
        vm.stopPrank();
        assertEq(_implementationOf(address(vault)), address(v2));
    }

    function test_implementation_cannotBeInitialized() public {
        address[] memory tokens = new address[](0);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(owner, steward, _policy(), tokens, 6, false);
    }

    function test_proxy_cannotBeInitializedTwice() public {
        address[] memory tokens = new address[](0);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(makeAddr("thief"), makeAddr("thiefSteward"), _policy(), tokens, 6, false);
    }

    function test_implementation_cannotBeUpgradedDirectly() public {
        vm.expectRevert();
        implementation.upgradeToAndCall(address(v2), "");
    }
}
