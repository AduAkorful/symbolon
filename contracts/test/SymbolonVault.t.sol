// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {VaultTest} from "./utils/VaultTest.sol";
import {Invoice, PayoutChange, SealRotation} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {IInvoiceLedger} from "../src/interfaces/IInvoiceLedger.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SymbolonVaultTest is VaultTest {
    uint256 internal constant SMALL = 500 * ONE_USDC;

    // ---------------------------------------------------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_stewardPaysVerifiedVendorWithinAutoPay() public {
        Invoice memory inv = _invoice(SMALL);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        bytes32 fp = ledger.fingerprint(inv);

        vm.expectEmit(address(vault));
        emit ISymbolonVault.Paid(fp, seal, steward, SMALL, SMALL, OPERATING, p.decisionHash);
        vm.prank(steward);
        uint256 paid = vault.pay(p, _noApprovals());

        assertEq(paid, SMALL);
        assertEq(usdc.balanceOf(payout), SMALL);
        assertEq(usdc.balanceOf(address(vault)), VAULT_FUNDS - SMALL);
        assertEq(usdc.allowance(address(vault), address(ledger)), 0);
        assertEq(lens.getPayee(address(vault), seal).paidCount, 1);
        assertEq(ledger.status(fp).credited, SMALL);
    }

    function test_pay_revertsForNonPayer() public {
        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ISymbolonVault.NotPayer.selector);
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsOnRetryOfPaidInvoice() public {
        Invoice memory inv = _invoice(SMALL);
        _stewardPays(inv, SMALL);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        bytes32 fp = ledger.fingerprint(inv);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.OverCredit.selector, fp, 0, SMALL));
        vault.pay(p, _noApprovals());
    }

    function test_pay_twoVaultsCannotBothPayOneInvoice() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        SymbolonVault other = SymbolonVault(payable(factory.createVault(owner, steward, _policy(), tokens, 6, false)));
        usdc.mint(address(other), VAULT_FUNDS);
        vm.prank(owner);
        other.addPayee(seal, payout, ARC_DOMAIN, _terms());

        Invoice memory inv = _invoice(SMALL);
        _stewardPays(inv, SMALL);

        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        vm.prank(steward);
        vm.expectRevert();
        other.pay(p, _noApprovals());
        assertEq(usdc.balanceOf(payout), SMALL);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Payee verification and change control
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_revertsForUnknownVendor() public {
        (address stranger, uint256 strangerKey) = makeAddrAndKey("unverifiedSeal");
        Invoice memory inv = _invoice(SMALL);
        inv.seal = stranger;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        p.sealSig = _signInvoice(inv, strangerKey);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnknownPayee.selector, stranger));
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsWhenInvoiceNamesUnconfirmedAddress() public {
        // the vendor's own Seal signed a new address, but the business never confirmed it
        Invoice memory inv = _invoice(SMALL);
        inv.payoutAddress = makeAddr("newWallet");
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayoutMismatch.selector, payout, ARC_DOMAIN));
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsBeforeNewPayeeDelay() public {
        ISymbolonVault.Policy memory pol = _policy();
        pol.newPayeeDelay = 1 days;
        vm.prank(owner);
        vault.setPolicy(pol);

        (address fresh, uint256 freshKey) = makeAddrAndKey("freshSeal");
        vm.prank(owner);
        vault.addPayee(fresh, payout, ARC_DOMAIN, _terms());

        Invoice memory inv = _invoice(SMALL);
        inv.seal = fresh;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        p.sealSig = _signInvoice(inv, freshKey);

        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.PayeeNotActive.selector, fresh, uint64(block.timestamp + 1 days))
        );
        vault.pay(p, _noApprovals());

        vm.warp(block.timestamp + 1 days);
        vm.prank(steward);
        vault.pay(p, _noApprovals());
    }

    function test_payoutChange_appliesOnlyAfterCooldown() public {
        address newWallet = makeAddr("newWallet");
        PayoutChange memory change =
            PayoutChange({seal: seal, newPayout: newWallet, payoutDomain: ARC_DOMAIN, nonce: 1});
        bytes memory sig = _signPayoutChange(change, sealKey);
        vm.prank(owner);
        vault.confirmPayoutChange(change, sig);

        // during the cooldown, invoices sealed with the old address still pay the old address
        _stewardPays(_invoice(SMALL), SMALL);
        assertEq(usdc.balanceOf(payout), SMALL);

        Invoice memory toNew = _invoice(SMALL);
        toNew.payoutAddress = newWallet;
        toNew.invoiceNumberHash = keccak256("INV-2");
        ISymbolonVault.PayParams memory p = _params(toNew, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayoutMismatch.selector, payout, ARC_DOMAIN));
        vault.pay(p, _noApprovals());

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(steward);
        vault.pay(p, _noApprovals());
        assertEq(usdc.balanceOf(newWallet), SMALL);

        Invoice memory toOld = _invoice(SMALL);
        toOld.invoiceNumberHash = keccak256("INV-3");
        ISymbolonVault.PayParams memory pOld = _params(toOld, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayoutMismatch.selector, newWallet, ARC_DOMAIN));
        vault.pay(pOld, _noApprovals());
    }

    function test_payoutChange_revertsWithoutSealSignature() public {
        (, uint256 attackerKey) = makeAddrAndKey("attacker");
        PayoutChange memory change =
            PayoutChange({seal: seal, newPayout: makeAddr("attackerWallet"), payoutDomain: ARC_DOMAIN, nonce: 1});
        bytes memory sig = _signPayoutChange(change, attackerKey);
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.InvalidSealSignature.selector);
        vault.confirmPayoutChange(change, sig);
    }

    function test_payoutChange_revertsOnStaleNonce() public {
        PayoutChange memory first =
            PayoutChange({seal: seal, newPayout: makeAddr("a"), payoutDomain: ARC_DOMAIN, nonce: 2});
        bytes memory firstSig = _signPayoutChange(first, sealKey);
        PayoutChange memory older =
            PayoutChange({seal: seal, newPayout: makeAddr("b"), payoutDomain: ARC_DOMAIN, nonce: 1});
        bytes memory olderSig = _signPayoutChange(older, sealKey);

        vm.startPrank(owner);
        vault.confirmPayoutChange(first, firstSig);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StaleNonce.selector, 2, 1));
        vault.confirmPayoutChange(older, olderSig);
        vm.stopPrank();
    }

    function test_payoutChange_stewardCannotConfirm() public {
        PayoutChange memory change =
            PayoutChange({seal: seal, newPayout: makeAddr("a"), payoutDomain: ARC_DOMAIN, nonce: 1});
        bytes memory sig = _signPayoutChange(change, sealKey);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, steward));
        vault.confirmPayoutChange(change, sig);
    }

    function test_cancelPayoutChange_keepsOldAddress() public {
        PayoutChange memory change =
            PayoutChange({seal: seal, newPayout: makeAddr("a"), payoutDomain: ARC_DOMAIN, nonce: 1});
        bytes memory sig = _signPayoutChange(change, sealKey);
        vm.startPrank(owner);
        vault.confirmPayoutChange(change, sig);
        vault.cancelPayoutChange(seal);
        vm.stopPrank();

        vm.warp(block.timestamp + COOLDOWN);
        (address current,) = lens.currentPayout(address(vault), seal);
        assertEq(current, payout);
        _stewardPays(_invoice(SMALL), SMALL);
    }

    function test_sealRotation_newSealPayableAfterCooldownAndOldRetired() public {
        (address newSeal, uint256 newKey) = makeAddrAndKey("newSeal");
        SealRotation memory rotation = SealRotation({oldSeal: seal, newSeal: newSeal, nonce: 1});
        bytes memory sig = _signRotation(rotation, sealKey);
        vm.prank(owner);
        vault.confirmSealRotation(rotation, sig);

        Invoice memory byNew = _invoice(SMALL);
        byNew.seal = newSeal;
        ISymbolonVault.PayParams memory pNew = _params(byNew, SMALL);
        pNew.sealSig = _signInvoice(byNew, newKey);
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.PayeeNotActive.selector, newSeal, uint64(block.timestamp + COOLDOWN))
        );
        vault.pay(pNew, _noApprovals());

        // old Seal still works during the cooldown
        _stewardPays(_invoice(SMALL), SMALL);

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(steward);
        vault.pay(pNew, _noApprovals());

        Invoice memory byOld = _invoice(SMALL);
        byOld.invoiceNumberHash = keccak256("late");
        ISymbolonVault.PayParams memory pOld = _params(byOld, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayeeRetired.selector, seal));
        vault.pay(pOld, _noApprovals());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Approvals
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_aboveAutoPayNeedsApprover() public {
        uint256 amount = 5_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);

        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Approver)
        );
        vault.pay(p, _noApprovals());

        ISymbolonVault.SignedApproval[] memory approvals = _approvalBy(approver, approverKey, inv, amount);
        vm.prank(steward);
        vault.pay(p, approvals);
        assertEq(usdc.balanceOf(payout), amount);
    }

    function test_pay_approverCanPayDirectly() public {
        uint256 amount = 5_000 * ONE_USDC;
        ISymbolonVault.PayParams memory p = _params(_invoice(amount), amount);
        vm.prank(approver);
        vault.pay(p, _noApprovals());
        assertEq(usdc.balanceOf(payout), amount);
    }

    function test_pay_aboveOwnerThresholdNeedsOwner() public {
        uint256 amount = 14_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        ISymbolonVault.SignedApproval[] memory byApprover = _approvalBy(approver, approverKey, inv, amount);

        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Owner)
        );
        vault.pay(p, byApprover);

        ISymbolonVault.SignedApproval[] memory byOwner = _approvalBy(owner, ownerKey, inv, amount);
        vm.prank(steward);
        vault.pay(p, byOwner);
        assertEq(usdc.balanceOf(payout), amount);
    }

    function test_pay_revertsOnApprovalForDifferentAmount() public {
        uint256 amount = 5_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        ISymbolonVault.SignedApproval[] memory approvals = _approvalBy(approver, approverKey, inv, 4_000 * ONE_USDC);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.InvalidApproval.selector, approver));
        vault.pay(p, approvals);
    }

    function test_pay_revertsOnExpiredApproval() public {
        uint256 amount = 5_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        ISymbolonVault.SignedApproval[] memory approvals = _approvalBy(approver, approverKey, inv, amount);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ApprovalExpired.selector, approver));
        vault.pay(p, approvals);
    }

    function test_pay_revertsOnApprovalFromNonApprover() public {
        uint256 amount = 5_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        (address rando, uint256 randoKey) = makeAddrAndKey("rando");
        ISymbolonVault.SignedApproval[] memory approvals = _approvalBy(rando, randoKey, inv, amount);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.InvalidApproval.selector, rando));
        vault.pay(p, approvals);
    }

    function test_pay_budgetApproverOnlyCountsForOwnBudget() public {
        bytes32 design = keccak256("design");
        (address designLead, uint256 designKey) = makeAddrAndKey("designLead");
        vm.startPrank(owner);
        vault.setBudget(design, 30_000 * ONE_USDC, 30 days);
        vault.setApprover(designLead, design, true);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setApprover(designLead, design, true);
        vm.stopPrank();

        uint256 amount = 5_000 * ONE_USDC;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        ISymbolonVault.SignedApproval[] memory approvals = _approvalBy(designLead, designKey, inv, amount);

        // the vendor is charged to the operating budget, which the design lead can't approve
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.InvalidApproval.selector, designLead));
        vault.pay(p, approvals);

        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.budget = design;
        vm.startPrank(owner);
        vault.updatePayeeTerms(seal, terms);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.updatePayeeTerms(seal, terms);
        vm.stopPrank();

        approvals = _approvalBy(designLead, designKey, inv, amount);
        vm.prank(steward);
        vault.pay(p, approvals);
        assertEq(lens.getBudget(address(vault), design).spent, amount);
    }

    function test_pay_newVendorNeedsApprover() public {
        ISymbolonVault.Policy memory pol = _policy();
        pol.newVendorMinPaid = 3;
        vm.prank(owner);
        vault.setPolicy(pol);

        Invoice memory inv = _invoice(SMALL);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Approver)
        );
        vault.pay(p, _noApprovals());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Screening
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_blockedVendorCannotBePaidEvenByOwner() public {
        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.Blocked, uint64(block.timestamp));
        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayeeBlocked.selector, seal));
        vault.pay(p, _noApprovals());
    }

    function test_pay_mediumRiskNeedsApproverHighRiskNeedsOwner() public {
        Invoice memory inv = _invoice(SMALL);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);

        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.Medium, uint64(block.timestamp));
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Approver)
        );
        vault.pay(p, _noApprovals());

        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.High, uint64(block.timestamp));
        ISymbolonVault.SignedApproval[] memory byApprover = _approvalBy(approver, approverKey, inv, SMALL);
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Owner)
        );
        vault.pay(p, byApprover);
    }

    function test_pay_revertsOnStaleScreening() public {
        ISymbolonVault.Policy memory pol = _policy();
        pol.screeningMaxAge = 30 days;
        vm.prank(owner);
        vault.setPolicy(pol);

        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ScreeningStale.selector, seal, 0));
        vault.pay(p, _noApprovals());

        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.Low, uint64(block.timestamp));
        vm.prank(steward);
        vault.pay(p, _noApprovals());

        vm.warp(block.timestamp + 30 days + 1);
        Invoice memory later = _invoice(SMALL);
        later.invoiceNumberHash = keccak256("later");
        ISymbolonVault.PayParams memory p2 = _params(later, SMALL);
        vm.prank(steward);
        vm.expectRevert();
        vault.pay(p2, _noApprovals());
    }

    function test_setScreening_stewardCannotScreen() public {
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.NotScreener.selector);
        vault.setScreening(seal, ISymbolonVault.Risk.Low, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Limits
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_revertsAbovePerTxCap() public {
        uint256 amount = PER_TX_CAP + 1;
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PerTxCapExceeded.selector, PER_TX_CAP, amount));
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsAboveMonthlyVendorCapAndResetsNextPeriod() public {
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.monthlyCap = 800 * ONE_USDC;
        vm.prank(owner);
        vault.updatePayeeTerms(seal, terms);

        _stewardPays(_invoice(SMALL), SMALL);
        Invoice memory second = _invoice(SMALL);
        second.invoiceNumberHash = keccak256("second");
        ISymbolonVault.PayParams memory p = _params(second, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PayeeCapExceeded.selector, 800 * ONE_USDC, SMALL, SMALL));
        vault.pay(p, _noApprovals());

        vm.warp(block.timestamp + 30 days);
        vm.prank(steward);
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsAboveBudget() public {
        bytes32 marketing = keccak256("marketing");
        vm.prank(owner);
        vault.setBudget(marketing, 800 * ONE_USDC, 30 days);
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.budget = marketing;
        vm.startPrank(owner);
        vault.updatePayeeTerms(seal, terms);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.updatePayeeTerms(seal, terms);
        vm.stopPrank();

        _stewardPays(_invoice(SMALL), SMALL);
        Invoice memory second = _invoice(SMALL);
        second.invoiceNumberHash = keccak256("second");
        ISymbolonVault.PayParams memory p = _params(second, SMALL);
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.BudgetExceeded.selector, marketing, 800 * ONE_USDC, SMALL, SMALL)
        );
        vault.pay(p, _noApprovals());
    }

    function test_pay_revertsForUnsupportedToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        Invoice memory inv = _invoice(SMALL);
        inv.token = address(other);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.UnsupportedToken.selector, address(other)));
        vault.pay(p, _noApprovals());
    }

    function test_setSupportedToken_rejectsWrongDecimals() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.TokenDecimalsMismatch.selector, address(token18), 18));
        vault.setSupportedToken(address(token18), true);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Matching
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_purchaseOrderRequiredAndDrawnDown() public {
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.requirePo = true;
        vm.prank(owner);
        vault.updatePayeeTerms(seal, terms);

        ISymbolonVault.PayParams memory noPo = _params(_invoice(SMALL), SMALL);
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.PurchaseOrderRequired.selector);
        vault.pay(noPo, _noApprovals());

        bytes32 poRef = keccak256("PO-7");
        vm.prank(owner);
        vault.openPurchaseOrder(poRef, seal, OPERATING, 800 * ONE_USDC, 0);

        Invoice memory inv = _invoice(SMALL);
        inv.poRef = poRef;
        _stewardPays(inv, SMALL);
        assertEq(lens.getPurchaseOrder(address(vault), poRef).remaining, 300 * ONE_USDC);

        Invoice memory over = _invoice(SMALL);
        over.poRef = poRef;
        over.invoiceNumberHash = keccak256("over");
        ISymbolonVault.PayParams memory pOver = _params(over, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderExceeded.selector, poRef, 300 * ONE_USDC));
        vault.pay(pOver, _noApprovals());
    }

    function test_pay_purchaseOrderForAnotherVendorReverts() public {
        bytes32 poRef = keccak256("PO-8");
        vm.prank(owner);
        vault.openPurchaseOrder(poRef, makeAddr("otherVendor"), OPERATING, 800 * ONE_USDC, 0);
        Invoice memory inv = _invoice(SMALL);
        inv.poRef = poRef;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderWrongVendor.selector, poRef));
        vault.pay(p, _noApprovals());
    }

    function test_pay_purchaseOrderReleaseDate() public {
        bytes32 poRef = keccak256("milestone-2");
        uint64 release = uint64(block.timestamp + 7 days);
        vm.prank(owner);
        vault.openPurchaseOrder(poRef, seal, OPERATING, SMALL, release);
        Invoice memory inv = _invoice(SMALL);
        inv.poRef = poRef;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderNotReleased.selector, poRef, release));
        vault.pay(p, _noApprovals());

        vm.warp(release);
        vm.prank(steward);
        vault.pay(p, _noApprovals());
    }

    function test_pay_closedPurchaseOrderReverts() public {
        bytes32 poRef = keccak256("PO-9");
        vm.startPrank(owner);
        vault.openPurchaseOrder(poRef, seal, OPERATING, SMALL, 0);
        vault.closePurchaseOrder(poRef);
        vm.stopPrank();
        Invoice memory inv = _invoice(SMALL);
        inv.poRef = poRef;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.PurchaseOrderNotOpen.selector, poRef));
        vault.pay(p, _noApprovals());
    }

    function test_pay_unknownPoReferenceDoesNotBlockWhenNotRequired() public {
        Invoice memory inv = _invoice(SMALL);
        inv.poRef = keccak256("client-side PO number");
        _stewardPays(inv, SMALL);
        assertEq(usdc.balanceOf(payout), SMALL);
    }

    function test_pay_deliveryRequiredUntilRequesterConfirms() public {
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.requireDelivery = true;
        vm.prank(owner);
        vault.updatePayeeTerms(seal, terms);

        Invoice memory inv = _invoice(SMALL);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        bytes32 fp = ledger.fingerprint(inv);

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.DeliveryNotConfirmed.selector, fp));
        vault.pay(p, _noApprovals());

        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.NotRequester.selector);
        vault.confirmDelivery(fp);

        vm.prank(requester);
        vault.confirmDelivery(fp);
        vm.prank(steward);
        vault.pay(p, _noApprovals());
    }

    function test_rejectDelivery_holdsPayment() public {
        ISymbolonVault.PayeeTerms memory terms = _terms();
        terms.requireDelivery = true;
        vm.prank(owner);
        vault.updatePayeeTerms(seal, terms);
        Invoice memory inv = _invoice(SMALL);
        bytes32 fp = ledger.fingerprint(inv);
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);

        vm.startPrank(requester);
        vault.confirmDelivery(fp);
        vault.rejectDelivery(fp, keccak256("wrong files"));
        vm.stopPrank();

        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.DeliveryNotConfirmed.selector, fp));
        vault.pay(p, _noApprovals());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Early Pay and cross-chain through the Vault
    // ---------------------------------------------------------------------------------------------------------------

    function test_pay_earlyPayTierChargesDiscountedAmount() public {
        Invoice memory inv = _withCurve(_invoice(SMALL));
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        p.discount = _tier(0);
        vm.prank(steward);
        uint256 paid = vault.pay(p, _noApprovals());

        uint256 expected = SMALL - (SMALL * 150) / 10_000;
        assertEq(paid, expected);
        assertEq(usdc.balanceOf(payout), expected);
        assertEq(usdc.balanceOf(address(vault)), VAULT_FUNDS - expected);
        assertEq(ledger.remaining(ledger.fingerprint(inv)), 0);
    }

    function test_pay_crossChainCountsFeeTowardLimits() public {
        vm.prank(owner);
        vault.removePayee(seal);
        vm.prank(owner);
        vault.addPayee(seal, payout, REMOTE_DOMAIN, _terms());

        Invoice memory inv = _invoice(SMALL);
        inv.payoutDomain = REMOTE_DOMAIN;
        ISymbolonVault.PayParams memory p = _params(inv, SMALL);
        p.maxFee = ONE_USDC;
        vm.prank(steward);
        vault.pay(p, _noApprovals());

        assertEq(usdc.balanceOf(address(vault)), VAULT_FUNDS - SMALL - ONE_USDC);
        assertEq(lens.getPayee(address(vault), seal).spentInPeriod, SMALL + ONE_USDC);
        assertEq(messenger.burnCount(), 1);
    }

    function test_pay_revertsOnBridgeFeeAboveMax() public {
        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        p.maxFee = MAX_BRIDGE_FEE + 1;
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.BridgeFeeTooHigh.selector, MAX_BRIDGE_FEE, MAX_BRIDGE_FEE + 1)
        );
        vault.pay(p, _noApprovals());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Owner controls, the Steward's limits, loosening delay
    // ---------------------------------------------------------------------------------------------------------------

    function test_pause_freezesPayments() public {
        vm.prank(owner);
        vault.pause();
        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.pay(p, _noApprovals());

        vm.prank(owner);
        vault.unpause();
        vm.prank(steward);
        vault.pay(p, _noApprovals());
    }

    function test_steward_cannotChangePolicyPayeesRolesOrWithdraw() public {
        vm.startPrank(steward);
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, steward);

        vm.expectRevert(unauthorized);
        vault.setPolicy(_policy());
        vm.expectRevert(unauthorized);
        vault.addPayee(makeAddr("x"), makeAddr("y"), ARC_DOMAIN, _terms());
        vm.expectRevert(unauthorized);
        vault.setSteward(makeAddr("z"));
        vm.expectRevert(unauthorized);
        vault.setApprover(steward, bytes32(0), true);
        vm.expectRevert(unauthorized);
        vault.withdraw(address(usdc), steward, 1);
        vm.expectRevert(unauthorized);
        vault.pause();
        vm.expectRevert(unauthorized);
        vault.unpause();
        vm.expectRevert(unauthorized);
        vault.setBudget(bytes32(0), type(uint256).max, 1 days);
        vm.stopPrank();
    }

    function test_steward_cannotBeGivenAnotherRole() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, steward));
        vault.setApprover(steward, bytes32(0), true);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, steward));
        vault.setRequester(steward, true);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, steward));
        vault.setScreener(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, approver));
        vault.setSteward(approver);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.StewardCannotHoldRole.selector, steward));
        vault.transferOwnership(steward);
        vm.stopPrank();
    }

    function test_setPolicy_looseningIsQueuedTighteningIsImmediate() public {
        ISymbolonVault.Policy memory looser = _policy();
        looser.autoPayLimit = 20_000 * ONE_USDC;

        vm.prank(owner);
        vault.setPolicy(looser);
        assertEq(lens.getPolicy(address(vault)).autoPayLimit, AUTO_PAY);

        vm.prank(owner);
        vm.expectRevert();
        vault.setPolicy(looser);

        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.setPolicy(looser);
        assertEq(lens.getPolicy(address(vault)).autoPayLimit, 20_000 * ONE_USDC);

        ISymbolonVault.Policy memory tighter = looser;
        tighter.autoPayLimit = 100 * ONE_USDC;
        vm.prank(owner);
        vault.setPolicy(tighter);
        assertEq(lens.getPolicy(address(vault)).autoPayLimit, 100 * ONE_USDC);
    }

    function test_setPolicy_compromisedOwnerCannotWidenAndPayInOneMinute() public {
        ISymbolonVault.Policy memory looser = _policy();
        looser.autoPayLimit = OWNER_THRESHOLD;
        vm.prank(owner);
        vault.setPolicy(looser);

        ISymbolonVault.PayParams memory p = _params(_invoice(5_000 * ONE_USDC), 5_000 * ONE_USDC);
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Approver)
        );
        vault.pay(p, _noApprovals());
    }

    function test_cancelQueuedChange_dropsIt() public {
        ISymbolonVault.Policy memory looser = _policy();
        looser.perTxCap = PER_TX_CAP * 2;
        bytes memory callData = abi.encodeCall(SymbolonVault.setPolicy, (looser));
        bytes32 id = lens.changeId(callData);

        vm.startPrank(owner);
        vault.setPolicy(looser);
        vault.cancelQueuedChange(id);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        // the call queues afresh instead of applying
        vault.setPolicy(looser);
        vm.stopPrank();
        assertEq(lens.getPolicy(address(vault)).perTxCap, PER_TX_CAP);
    }

    function test_setSteward_revokeIsImmediateAppointIsQueued() public {
        vm.prank(owner);
        vault.setSteward(address(0));
        assertEq(lens.steward(address(vault)), address(0));

        ISymbolonVault.PayParams memory p = _params(_invoice(SMALL), SMALL);
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.NotPayer.selector);
        vault.pay(p, _noApprovals());

        vm.prank(owner);
        vault.setSteward(steward);
        assertEq(lens.steward(address(vault)), address(0));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.setSteward(steward);
        assertEq(lens.steward(address(vault)), steward);
    }

    function test_anchorDecisions_onlySteward() public {
        vm.expectEmit(address(vault));
        emit ISymbolonVault.DecisionsAnchored(keccak256("root"), 12);
        vm.prank(steward);
        vault.anchorDecisions(keccak256("root"), 12);

        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.NotSteward.selector);
        vault.anchorDecisions(keccak256("root"), 12);
    }

    function test_withdraw_ownerOnly() public {
        address treasury = makeAddr("treasury");
        vm.prank(owner);
        vault.withdraw(address(usdc), treasury, 1_000 * ONE_USDC);
        assertEq(usdc.balanceOf(treasury), 1_000 * ONE_USDC);
    }

    function test_factory_recordsVault() public view {
        assertTrue(factory.isVault(address(vault)));
        assertEq(vault.owner(), owner);
        assertEq(lens.steward(address(vault)), steward);
        assertEq(address(vault.ledger()), address(ledger));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------------------------------------------------

    function testFuzz_pay_requiredApprovalMatchesThresholds(uint256 amount) public {
        amount = bound(amount, 1, PER_TX_CAP);
        Invoice memory inv = _invoice(amount);
        ISymbolonVault.PayParams memory p = _params(inv, amount);

        if (amount <= AUTO_PAY) {
            vm.prank(steward);
            vault.pay(p, _noApprovals());
        } else if (amount <= OWNER_THRESHOLD) {
            ISymbolonVault.SignedApproval[] memory a = _approvalBy(approver, approverKey, inv, amount);
            vm.prank(steward);
            vault.pay(p, a);
        } else {
            ISymbolonVault.SignedApproval[] memory a = _approvalBy(approver, approverKey, inv, amount);
            vm.prank(steward);
            vm.expectRevert(
                abi.encodeWithSelector(ISymbolonVault.ApprovalRequired.selector, ISymbolonVault.ApprovalLevel.Owner)
            );
            vault.pay(p, a);
            a = _approvalBy(owner, ownerKey, inv, amount);
            vm.prank(steward);
            vault.pay(p, a);
        }
        assertEq(usdc.balanceOf(payout), amount);
    }
}
