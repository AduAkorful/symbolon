// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {VaultTest} from "./utils/VaultTest.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {SymbolonVaultV2} from "./mocks/SymbolonVaultV2.sol";

/// @notice Release 3 (plan 01c): the Vault accepts Arc's native coin, which is the same USDC balance the ERC-20 shows.
/// These tests run on the local EVM's own native coin; Arc's precompile can't run here, so the live behaviour is
/// proven on testnet (plan 01c section 5).
contract NativeReceiveTest is VaultTest {
    address internal funder = makeAddr("funder");

    function _send(address from, uint256 amount) internal returns (bool ok) {
        vm.deal(from, amount);
        vm.prank(from);
        (ok,) = address(vault).call{value: amount}("");
    }

    function test_receive_acceptsValueAndEmits() public {
        vm.expectEmit(address(vault));
        emit ISymbolonVault.NativeReceived(funder, 45 ether);
        assertTrue(_send(funder, 45 ether));
        assertEq(address(vault).balance, 45 ether);
    }

    function testFuzz_receive_anyAmount(address from, uint96 amount) public {
        vm.assume(from != address(vault) && from.code.length == 0 && uint160(from) > 0xFFFF);
        vm.expectEmit(address(vault));
        emit ISymbolonVault.NativeReceived(from, amount);
        assertTrue(_send(from, amount));
        assertEq(address(vault).balance, amount);
    }

    function test_receive_worksWhilePaused() public {
        vm.prank(owner);
        vault.pause();
        assertTrue(_send(funder, 1 ether));
        assertEq(address(vault).balance, 1 ether);
    }

    function test_receive_zeroValueAccepted() public {
        vm.expectEmit(address(vault));
        emit ISymbolonVault.NativeReceived(funder, 0);
        assertTrue(_send(funder, 0));
    }

    function test_receive_changesNoState() public {
        bytes32 slot0 = vm.load(address(vault), bytes32(uint256(0)));
        address stewardBefore = lens.steward(address(vault));
        uint256 tokenBefore = usdc.balanceOf(address(vault));
        assertTrue(_send(funder, 3 ether));
        assertEq(vm.load(address(vault), bytes32(uint256(0))), slot0);
        assertEq(lens.steward(address(vault)), stewardBefore);
        assertEq(usdc.balanceOf(address(vault)), tokenBefore);
    }

    function test_receive_withCalldataStillRevertsOnUnknownSelector() public {
        // only an empty call is a deposit; a wrong selector must not be swallowed
        vm.deal(funder, 1 ether);
        vm.prank(funder);
        (bool ok,) = address(vault).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
    }

    function test_receive_survivesAnUpgrade() public {
        SymbolonVaultV2 next = new SymbolonVaultV2(ledger, registry);
        vm.startPrank(owner);
        vault.scheduleUpgrade(address(next));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.upgradeToAndCall(address(next), "");
        vm.stopPrank();
        assertEq(lens.steward(address(vault)), steward);
        assertTrue(_send(funder, 2 ether));
        assertEq(address(vault).balance, 2 ether);
    }

    // ---- purchase orders cannot be re-opened (plan 01c section 2.3) ----

    function test_openPurchaseOrder_revertsWhenOpen() public {
        bytes32 poRef = keccak256("po-1");
        vm.startPrank(owner);
        vault.openPurchaseOrder(poRef, seal, OPERATING, 800 * ONE_USDC, 0);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderExists.selector, poRef));
        vault.openPurchaseOrder(poRef, seal, OPERATING, 5 * ONE_USDC, 0);
        vm.stopPrank();
        assertEq(lens.getPurchaseOrder(address(vault), poRef).remaining, 800 * ONE_USDC);
    }

    function test_openPurchaseOrder_revertsWhenClosed() public {
        bytes32 poRef = keccak256("po-2");
        vm.startPrank(owner);
        vault.openPurchaseOrder(poRef, seal, OPERATING, 800 * ONE_USDC, 0);
        vault.closePurchaseOrder(poRef);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderExists.selector, poRef));
        vault.openPurchaseOrder(poRef, seal, OPERATING, 800 * ONE_USDC, 0);
        vm.stopPrank();
        assertFalse(lens.getPurchaseOrder(address(vault), poRef).open);
    }

    function test_openPurchaseOrder_newReferenceStillOpens() public {
        vm.startPrank(owner);
        vault.openPurchaseOrder(keccak256("a"), seal, OPERATING, 1, 0);
        vault.openPurchaseOrder(keccak256("b"), seal, OPERATING, 2, 0);
        vm.stopPrank();
        assertEq(lens.getPurchaseOrder(address(vault), keccak256("b")).remaining, 2);
    }
}
