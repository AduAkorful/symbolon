// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {VaultTest} from "./utils/VaultTest.sol";
import {Invoice, CreditNote, SealRotation} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {IInvoiceLedger} from "../src/interfaces/IInvoiceLedger.sol";
import {IUsycTeller} from "../src/interfaces/IUsycTeller.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";

/// @notice Every fail-closed guard that the flow tests don't reach
contract GuardsTest is VaultTest {
    function test_initialize_rejectsStewardAsOwner() public {
        address[] memory tokens = new address[](0);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, owner));
        factory.createVault(owner, owner, _policy(), tokens, 6, false);
    }

    function test_constructor_rejectsZeroLedger() public {
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        new SymbolonVault(IInvoiceLedger(address(0)), registry, IUsycTeller(address(0)));
    }

    function test_addPayee_guards() public {
        vm.startPrank(owner);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.addPayee(address(0), payout, ARC_DOMAIN, _terms());
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.addPayee(makeAddr("s"), address(0), ARC_DOMAIN, _terms());
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayeeExists.selector, seal));
        vault.addPayee(seal, payout, ARC_DOMAIN, _terms());
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.budget = keccak256("missing");
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownBudget.selector, terms.budget));
        vault.addPayee(makeAddr("s"), payout, ARC_DOMAIN, terms);
        vm.stopPrank();
    }

    function test_payeeManagement_unknownPayee() public {
        address ghost = makeAddr("ghost");
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownPayee.selector, ghost));
        vault.removePayee(ghost);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownPayee.selector, ghost));
        vault.updatePayeeTerms(ghost, _terms());
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.NoPendingPayoutChange.selector, ghost));
        vault.cancelPayoutChange(ghost);
        vm.stopPrank();
        vm.prank(screener);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownPayee.selector, ghost));
        vault.setScreening(ghost, ISymbolonVault.Risk.Low, 0);
    }

    function test_setScreening_rejectsFutureTimestamp() public {
        vm.prank(screener);
        vm.expectRevert(ISymbolonVault.InvalidScreeningTime.selector);
        vault.setScreening(seal, ISymbolonVault.Risk.Low, uint64(block.timestamp + 1));
    }

    function test_sealRotation_guards() public {
        (address newSeal,) = makeAddrAndKey("newSeal");
        (, uint256 otherKey) = makeAddrAndKey("other");
        SealRotation memory rotation = SealRotation({oldSeal: seal, newSeal: newSeal, nonce: 1});
        bytes memory badSig = _signRotation(rotation, otherKey);
        bytes memory goodSig = _signRotation(rotation, sealKey);
        SealRotation memory toExisting = SealRotation({oldSeal: seal, newSeal: seal, nonce: 1});
        bytes memory toExistingSig = _signRotation(toExisting, sealKey);

        vm.startPrank(owner);
        vm.expectRevert(ISymbolonVault.InvalidSealSignature.selector);
        vault.confirmSealRotation(rotation, badSig);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayeeExists.selector, seal));
        vault.confirmSealRotation(toExisting, toExistingSig);
        vault.confirmSealRotation(rotation, goodSig);
        SealRotation memory stale = SealRotation({oldSeal: seal, newSeal: makeAddr("n2"), nonce: 1});
        vm.stopPrank();
        bytes memory staleSig = _signRotation(stale, sealKey);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StaleNonce.selector, 1, 1));
        vault.confirmSealRotation(stale, staleSig);
    }

    function test_budget_guardsAndLoosening() public {
        bytes32 ops = keccak256("ops");
        vm.startPrank(owner);
        vm.expectRevert(ISymbolonVault.InvalidPeriod.selector);
        vault.setBudget(ops, 1, 0);
        vault.setBudget(ops, 1_000 * ONE_USDC, 30 days);
        assertEq(lens.getBudget(address(vault), ops).cap, 1_000 * ONE_USDC);

        // raising a cap is loosening: queued, then applied after the delay
        vault.setBudget(ops, 2_000 * ONE_USDC, 30 days);
        assertEq(lens.getBudget(address(vault), ops).cap, 1_000 * ONE_USDC);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setBudget(ops, 2_000 * ONE_USDC, 30 days);
        assertEq(lens.getBudget(address(vault), ops).cap, 2_000 * ONE_USDC);

        // lowering is immediate; changing the period restarts it
        vault.setBudget(ops, 500 * ONE_USDC, 60 days);
        assertEq(lens.getBudget(address(vault), ops).cap, 500 * ONE_USDC);
        assertEq(lens.getBudget(address(vault), ops).periodLength, 60 days);
        vm.stopPrank();
    }

    function test_purchaseOrder_guards() public {
        vm.startPrank(owner);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.openPurchaseOrder(bytes32(0), seal, OPERATING, 1, 0);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.openPurchaseOrder(keccak256("po"), address(0), OPERATING, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownBudget.selector, keccak256("b")));
        vault.openPurchaseOrder(keccak256("po"), seal, keccak256("b"), 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderNotOpen.selector, keccak256("po")));
        vault.closePurchaseOrder(keccak256("po"));
        vm.stopPrank();
    }

    function test_roles_guards() public {
        vm.startPrank(owner);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.setApprover(address(0), OPERATING, true);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.setRequester(address(0), true);
        vm.expectRevert(ISymbolonVault.ZeroAddress.selector);
        vault.withdraw(address(usdc), address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownChange.selector, bytes32(uint256(1))));
        vault.cancelQueuedChange(bytes32(uint256(1)));

        // revoking roles is immediate
        vault.setApprover(approver, OPERATING, false);
        assertFalse(lens.isApprover(address(vault), approver, OPERATING));
        vault.setRequester(requester, false);
        assertFalse(lens.isRequester(address(vault), requester));
        vault.setScreener(address(0));
        assertEq(lens.screener(address(vault)), address(0));
        vault.setSupportedToken(address(usdc), false);
        assertFalse(lens.isSupportedToken(address(vault), address(usdc)));
        // a no-op grant doesn't queue anything
        vault.setApprover(approver, OPERATING, false);
        vm.stopPrank();
    }

    function test_steward_cannotBecomePendingOwnersRole() public {
        address next = makeAddr("nextOwner");
        vm.startPrank(owner);
        vault.transferOwnership(next);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, next));
        vault.setSteward(next);
        vm.stopPrank();
    }

    function test_ledger_cancelTwiceAndCreditNoteGuards() public {
        Invoice memory inv = _invoice(1_000 * ONE_USDC);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        bytes memory cancelSig = _signCancel(fp, sealKey);

        CreditNote memory zero = CreditNote({fingerprint: fp, amount: 0, documentHash: bytes32(0), nonce: 1});
        bytes memory zeroSig = _signCreditNote(zero, sealKey);
        vm.expectRevert(
            abi.encodeWithSelector(IInvoiceLedger.CreditNoteExceedsOutstanding.selector, 1_000 * ONE_USDC, 0)
        );
        ledger.applyCreditNote(inv, sig, zero, zeroSig);

        CreditNote memory other = CreditNote({fingerprint: fp, amount: 1, documentHash: bytes32(0), nonce: 2});
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory otherSig = _signCreditNote(other, otherKey);
        vm.expectRevert(IInvoiceLedger.InvalidCreditNoteSignature.selector);
        ledger.applyCreditNote(inv, sig, other, otherSig);

        ledger.cancel(inv, sig, cancelSig);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvoiceCancelled.selector, fp));
        ledger.cancel(inv, sig, cancelSig);

        bytes memory noteSig = _signCreditNote(other, sealKey);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvoiceCancelled.selector, fp));
        ledger.applyCreditNote(inv, sig, other, noteSig);
        assertEq(ledger.remaining(fp), 0);
    }

    function test_ledger_rejectsZeroSeal() public {
        Invoice memory inv = _invoice(ONE_USDC);
        inv.seal = address(0);
        // ecrecover returns zero for malformed signatures; a zero Seal must never match it
        bytes memory junk = new bytes(65);
        _fundPayer(payer, ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidSealSignature.selector);
        ledger.settle(inv, junk, ONE_USDC, _noDiscount(), 0);
    }
}
