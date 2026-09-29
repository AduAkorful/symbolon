// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SymbolonTest} from "./utils/SymbolonTest.sol";
import {MockSmartWallet} from "./mocks/MockSmartWallet.sol";
import {Invoice, CreditNote, DiscountProof} from "../src/types/SealTypes.sol";
import {IInvoiceLedger} from "../src/interfaces/IInvoiceLedger.sol";
import {InvoiceLedger} from "../src/InvoiceLedger.sol";

contract InvoiceLedgerTest is SymbolonTest {
    uint256 internal constant AMOUNT = 2_400 * ONE_USDC;

    function setUp() public override {
        super.setUp();
        _fundPayer(payer, 1_000_000 * ONE_USDC);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // settle
    // ---------------------------------------------------------------------------------------------------------------

    function test_settle_paysSignedPayoutAndRecordsCredit() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        vm.expectEmit(address(ledger));
        emit IInvoiceLedger.Settled(fp, seal, payer, address(usdc), AMOUNT, AMOUNT, 0, ARC_DOMAIN, payout);
        vm.prank(payer);
        uint256 paid = ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);

        assertEq(paid, AMOUNT);
        assertEq(usdc.balanceOf(payout), AMOUNT);
        IInvoiceLedger.InvoiceState memory st = ledger.status(fp);
        assertEq(st.total, AMOUNT);
        assertEq(st.credited, AMOUNT);
        assertEq(st.seal, seal);
        assertTrue(st.seen);
        assertEq(ledger.remaining(fp), 0);
    }

    function test_settle_revertsWhenPaidTwice() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        vm.startPrank(payer);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.OverCredit.selector, fp, 0, AMOUNT));
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
        vm.stopPrank();
    }

    function test_settle_allowsPartialThenRemainder() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        vm.startPrank(payer);
        ledger.settle(inv, sig, 1_000 * ONE_USDC, _noDiscount(), 0);
        assertEq(ledger.remaining(fp), 1_400 * ONE_USDC);
        ledger.settle(inv, sig, 1_400 * ONE_USDC, _noDiscount(), 0);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.OverCredit.selector, fp, 0, 1));
        ledger.settle(inv, sig, 1, _noDiscount(), 0);
        vm.stopPrank();
        assertEq(usdc.balanceOf(payout), AMOUNT);
    }

    function test_settle_revertsForWrongSigner() public {
        Invoice memory inv = _invoice(AMOUNT);
        (, uint256 otherKey) = makeAddrAndKey("impostor");
        bytes memory sig = _signInvoice(inv, otherKey);

        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidSealSignature.selector);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
    }

    function test_settle_revertsWhenPayoutAddressTampered() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        inv.payoutAddress = makeAddr("attacker");

        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidSealSignature.selector);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
    }

    function test_settle_revertsWhenAmountTampered() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        inv.amount = AMOUNT * 2;

        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidSealSignature.selector);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
    }

    function test_settle_revertsOnZeroCredit() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.ZeroCredit.selector);
        ledger.settle(inv, sig, 0, _noDiscount(), 0);
    }

    function test_settle_revertsOnZeroPayoutAddress() public {
        Invoice memory inv = _invoice(AMOUNT);
        inv.payoutAddress = address(0);
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.ZeroPayoutAddress.selector);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
    }

    function test_settle_acceptsErc1271Seal() public {
        (address walletSigner, uint256 walletKey) = makeAddrAndKey("walletSigner");
        MockSmartWallet wallet = new MockSmartWallet(walletSigner);
        Invoice memory inv = _invoice(AMOUNT);
        inv.seal = address(wallet);
        bytes memory sig = _signInvoice(inv, walletKey);

        vm.prank(payer);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
        assertEq(usdc.balanceOf(payout), AMOUNT);
    }

    function test_settle_acceptsEcdsaSealWithDelegatedCode() public {
        // an EIP-7702-delegated EOA has code but still signs with its own key
        vm.etch(seal, hex"ef0100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);

        vm.prank(payer);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
        assertEq(usdc.balanceOf(payout), AMOUNT);
    }

    function test_settle_revertsOnLocalPayoutWithFee() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.FeeOnLocalPayout.selector);
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 1);
    }

    function test_settle_burnsPaidPlusFeeForCrossChainPayout() public {
        Invoice memory inv = _invoice(AMOUNT);
        inv.payoutDomain = REMOTE_DOMAIN;
        bytes memory sig = _signInvoice(inv, sealKey);
        uint256 maxFee = 2 * ONE_USDC;
        uint256 payerBefore = usdc.balanceOf(payer);

        vm.prank(payer);
        uint256 paid = ledger.settle(inv, sig, AMOUNT, _noDiscount(), maxFee);

        assertEq(paid, AMOUNT);
        assertEq(payerBefore - usdc.balanceOf(payer), AMOUNT + maxFee);
        assertEq(messenger.burnCount(), 1);
        (
            uint256 amount,
            uint32 domain,
            bytes32 recipient,
            address burnToken,
            bytes32 caller,
            uint256 fee,
            uint32 finality
        ) = messenger.burns(0);
        assertEq(amount, AMOUNT + maxFee);
        assertEq(domain, REMOTE_DOMAIN);
        assertEq(recipient, bytes32(uint256(uint160(payout))));
        assertEq(burnToken, address(usdc));
        assertEq(caller, bytes32(0));
        assertEq(fee, maxFee);
        assertEq(finality, 2_000);
        assertEq(usdc.balanceOf(address(ledger)), 0);
    }

    function test_settle_revertsCrossChainWhenDisabled() public {
        InvoiceLedger localOnly = new InvoiceLedger(address(0), ARC_DOMAIN);
        Invoice memory inv = _invoice(AMOUNT);
        inv.payoutDomain = REMOTE_DOMAIN;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sealKey, localOnly.fingerprint(inv));

        vm.startPrank(payer);
        usdc.approve(address(localOnly), type(uint256).max);
        vm.expectRevert(IInvoiceLedger.CrossChainDisabled.selector);
        localOnly.settle(inv, abi.encodePacked(r, s, v), AMOUNT, _noDiscount(), 0);
        vm.stopPrank();
    }

    function test_fingerprint_differsAcrossLedgers() public {
        InvoiceLedger other = new InvoiceLedger(address(0), ARC_DOMAIN);
        Invoice memory inv = _invoice(AMOUNT);
        assertTrue(other.fingerprint(inv) != ledger.fingerprint(inv));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Early Pay
    // ---------------------------------------------------------------------------------------------------------------

    function test_settle_appliesSignedCurveTier() public {
        Invoice memory inv = _withCurve(_invoice(AMOUNT));
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        vm.prank(payer);
        uint256 paid = ledger.settle(inv, sig, AMOUNT, _tier(0), 0);

        // 1.5% of 2,400 = 36
        assertEq(paid, 2_364 * ONE_USDC);
        assertEq(usdc.balanceOf(payout), 2_364 * ONE_USDC);
        assertEq(ledger.status(fp).credited, AMOUNT);
        assertEq(ledger.remaining(fp), 0);
    }

    function test_settle_revertsOnExpiredTier() public {
        Invoice memory inv = _withCurve(_invoice(AMOUNT));
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.DiscountExpired.selector);
        ledger.settle(inv, sig, AMOUNT, _tier(0), 0);

        // the later tier still applies
        vm.prank(payer);
        assertEq(ledger.settle(inv, sig, AMOUNT, _tier(1), 0), 2_382 * ONE_USDC);
    }

    function test_settle_revertsOnUnknownTier() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvalidDiscountTier.selector, 0));
        ledger.settle(inv, sig, AMOUNT, _tier(0), 0);
    }

    function test_settle_appliesSignedCashNowOffer() public {
        Invoice memory inv = _invoice(9_000 * ONE_USDC);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        DiscountProof memory offerProof = _offer(fp, 120, uint64(block.timestamp + 1 hours), sealKey);
        vm.prank(payer);
        uint256 paid = ledger.settle(inv, sig, 9_000 * ONE_USDC, offerProof, 0);
        assertEq(paid, 8_892 * ONE_USDC);
    }

    function test_settle_revertsOnOfferSignedByOthers() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        (, uint256 payerKey) = makeAddrAndKey("payerKey");

        DiscountProof memory offerProof = _offer(fp, 500, uint64(block.timestamp + 1 hours), payerKey);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidOfferSignature.selector);
        ledger.settle(inv, sig, AMOUNT, offerProof, 0);
    }

    function test_settle_revertsOnOfferForAnotherInvoice() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);

        DiscountProof memory offerProof = _offer(keccak256("other"), 100, uint64(block.timestamp + 1 hours), sealKey);
        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidOfferSignature.selector);
        ledger.settle(inv, sig, AMOUNT, offerProof, 0);
    }

    function test_settle_revertsOnTamperedOfferRate() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        DiscountProof memory d = _offer(fp, 100, uint64(block.timestamp + 1 hours), sealKey);
        d.offerBps = 1_000;

        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.InvalidOfferSignature.selector);
        ledger.settle(inv, sig, AMOUNT, d, 0);
    }

    function test_settle_revertsOnExpiredOffer() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        DiscountProof memory d = _offer(fp, 100, uint64(block.timestamp + 1 hours), sealKey);
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(payer);
        vm.expectRevert(IInvoiceLedger.DiscountExpired.selector);
        ledger.settle(inv, sig, AMOUNT, d, 0);
    }

    function test_settle_revertsOnDiscountAboveMaximum() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        DiscountProof memory offerProof = _offer(fp, 5_001, uint64(block.timestamp + 1 hours), sealKey);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.DiscountTooLarge.selector, 5_001));
        ledger.settle(inv, sig, AMOUNT, offerProof, 0);
    }

    function test_quote_roundsDiscountInVendorsFavour() public view {
        Invoice memory inv = _invoice(AMOUNT);
        bytes32 fp = ledger.fingerprint(inv);
        // 1 bps of 199 units = 0.0199, rounds down to 0 discount
        (uint256 paid, uint16 bps) = ledger.quote(inv, 199, _offer(fp, 1, uint64(block.timestamp + 1), sealKey));
        assertEq(bps, 1);
        assertEq(paid, 199);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Cancel, credit notes, replacements
    // ---------------------------------------------------------------------------------------------------------------

    function test_cancel_preventsPayment() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        ledger.cancel(inv, sig, _signCancel(fp, sealKey));
        assertTrue(ledger.status(fp).cancelled);
        assertEq(ledger.remaining(fp), 0);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvoiceCancelled.selector, fp));
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
    }

    function test_cancel_revertsAfterPartialPayment() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        vm.prank(payer);
        ledger.settle(inv, sig, ONE_USDC, _noDiscount(), 0);

        bytes memory cancelSig = _signCancel(fp, sealKey);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.AlreadyPaidInPart.selector, fp));
        ledger.cancel(inv, sig, cancelSig);
    }

    function test_cancel_revertsWhenNotSignedBySeal() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory cancelSig = _signCancel(fp, otherKey);

        vm.expectRevert(IInvoiceLedger.InvalidCancelSignature.selector);
        ledger.cancel(inv, sig, cancelSig);
    }

    function test_applyCreditNote_reducesTotal() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        CreditNote memory note =
            CreditNote({fingerprint: fp, amount: 400 * ONE_USDC, documentHash: keccak256("cn-1"), nonce: 1});

        ledger.applyCreditNote(inv, sig, note, _signCreditNote(note, sealKey));
        assertEq(ledger.status(fp).total, 2_000 * ONE_USDC);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.OverCredit.selector, fp, 2_000 * ONE_USDC, AMOUNT));
        ledger.settle(inv, sig, AMOUNT, _noDiscount(), 0);
        vm.prank(payer);
        ledger.settle(inv, sig, 2_000 * ONE_USDC, _noDiscount(), 0);
    }

    function test_applyCreditNote_cannotBeReplayed() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        CreditNote memory note =
            CreditNote({fingerprint: fp, amount: 100 * ONE_USDC, documentHash: keccak256("cn-1"), nonce: 1});
        bytes memory noteSig = _signCreditNote(note, sealKey);

        ledger.applyCreditNote(inv, sig, note, noteSig);
        vm.expectRevert(
            abi.encodeWithSelector(
                IInvoiceLedger.CreditNoteAlreadyUsed.selector, ledger.hashTypedData(_hashCreditNote(note))
            )
        );
        ledger.applyCreditNote(inv, sig, note, noteSig);
    }

    function test_applyCreditNote_cannotGoBelowCredited() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);
        vm.prank(payer);
        ledger.settle(inv, sig, 2_000 * ONE_USDC, _noDiscount(), 0);

        CreditNote memory note =
            CreditNote({fingerprint: fp, amount: 500 * ONE_USDC, documentHash: keccak256("cn-1"), nonce: 1});
        bytes memory noteSig = _signCreditNote(note, sealKey);
        vm.expectRevert(
            abi.encodeWithSelector(IInvoiceLedger.CreditNoteExceedsOutstanding.selector, 400 * ONE_USDC, 500 * ONE_USDC)
        );
        ledger.applyCreditNote(inv, sig, note, noteSig);
    }

    function test_applyCreditNote_revertsForOtherInvoice() public {
        Invoice memory inv = _invoice(AMOUNT);
        bytes memory sig = _signInvoice(inv, sealKey);
        CreditNote memory note =
            CreditNote({fingerprint: keccak256("other"), amount: 1, documentHash: bytes32(0), nonce: 1});
        bytes memory noteSig = _signCreditNote(note, sealKey);
        vm.expectRevert(IInvoiceLedger.CreditNoteWrongInvoice.selector);
        ledger.applyCreditNote(inv, sig, note, noteSig);
    }

    function test_settle_replacementCancelsUnpaidOriginal() public {
        Invoice memory original = _invoice(AMOUNT);
        bytes memory originalSig = _signInvoice(original, sealKey);
        bytes32 originalFp = ledger.fingerprint(original);

        Invoice memory corrected = _invoice(2_000 * ONE_USDC);
        corrected.replaces = originalFp;
        bytes memory correctedSig = _signInvoice(corrected, sealKey);

        vm.startPrank(payer);
        ledger.settle(corrected, correctedSig, 2_000 * ONE_USDC, _noDiscount(), 0);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvoiceCancelled.selector, originalFp));
        ledger.settle(original, originalSig, AMOUNT, _noDiscount(), 0);
        vm.stopPrank();
    }

    function test_settle_replacementOfSeenOriginalCancelsIt() public {
        Invoice memory original = _invoice(AMOUNT);
        bytes memory originalSig = _signInvoice(original, sealKey);
        bytes32 originalFp = ledger.fingerprint(original);
        CreditNote memory note = CreditNote({fingerprint: originalFp, amount: 1, documentHash: bytes32(0), nonce: 1});
        ledger.applyCreditNote(original, originalSig, note, _signCreditNote(note, sealKey));

        Invoice memory corrected = _invoice(2_000 * ONE_USDC);
        corrected.replaces = originalFp;
        bytes memory correctedSig = _signInvoice(corrected, sealKey);

        vm.prank(payer);
        ledger.settle(corrected, correctedSig, 2_000 * ONE_USDC, _noDiscount(), 0);
        assertTrue(ledger.status(originalFp).cancelled);
    }

    function test_settle_replacementRevertsWhenOriginalPartlyPaid() public {
        Invoice memory original = _invoice(AMOUNT);
        bytes memory originalSig = _signInvoice(original, sealKey);
        bytes32 originalFp = ledger.fingerprint(original);
        vm.prank(payer);
        ledger.settle(original, originalSig, ONE_USDC, _noDiscount(), 0);

        Invoice memory corrected = _invoice(2_000 * ONE_USDC);
        corrected.replaces = originalFp;
        bytes memory correctedSig = _signInvoice(corrected, sealKey);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.ReplacedInvoiceHasPayments.selector, originalFp));
        ledger.settle(corrected, correctedSig, 2_000 * ONE_USDC, _noDiscount(), 0);
    }

    function test_settle_replacementCannotCancelAnotherVendorsInvoice() public {
        // victim's invoice exists offchain but hasn't touched the ledger yet
        Invoice memory victim = _invoice(AMOUNT);
        bytes memory victimSig = _signInvoice(victim, sealKey);
        bytes32 victimFp = ledger.fingerprint(victim);

        (address attacker, uint256 attackerKey) = makeAddrAndKey("attackerSeal");
        Invoice memory hostile = _invoice(ONE_USDC);
        hostile.seal = attacker;
        hostile.replaces = victimFp;
        bytes memory hostileSig = _signInvoice(hostile, attackerKey);

        vm.startPrank(payer);
        ledger.settle(hostile, hostileSig, ONE_USDC, _noDiscount(), 0);
        ledger.settle(victim, victimSig, AMOUNT, _noDiscount(), 0);
        vm.stopPrank();
        assertEq(ledger.status(victimFp).credited, AMOUNT);
    }

    function test_settle_replacementStillBindsAfterHostilePreCancel() public {
        Invoice memory original = _invoice(AMOUNT);
        bytes memory originalSig = _signInvoice(original, sealKey);
        bytes32 originalFp = ledger.fingerprint(original);

        (address attacker, uint256 attackerKey) = makeAddrAndKey("attackerSeal");
        Invoice memory hostile = _invoice(ONE_USDC);
        hostile.seal = attacker;
        hostile.replaces = originalFp;
        bytes memory hostileSig = _signInvoice(hostile, attackerKey);

        Invoice memory corrected = _invoice(2_000 * ONE_USDC);
        corrected.replaces = originalFp;
        bytes memory correctedSig = _signInvoice(corrected, sealKey);

        vm.startPrank(payer);
        ledger.settle(hostile, hostileSig, ONE_USDC, _noDiscount(), 0);
        ledger.settle(corrected, correctedSig, 2_000 * ONE_USDC, _noDiscount(), 0);
        vm.expectRevert(abi.encodeWithSelector(IInvoiceLedger.InvoiceCancelled.selector, originalFp));
        ledger.settle(original, originalSig, AMOUNT, _noDiscount(), 0);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------------------------------------------------------

    function testFuzz_settle_neverOverCredits(uint256 amount, uint256 first, uint256 second) public {
        amount = bound(amount, 1, 1e30);
        first = bound(first, 1, amount);
        second = bound(second, 1, type(uint128).max);
        usdc.mint(payer, 2e30);

        Invoice memory inv = _invoice(amount);
        bytes memory sig = _signInvoice(inv, sealKey);
        bytes32 fp = ledger.fingerprint(inv);

        vm.startPrank(payer);
        ledger.settle(inv, sig, first, _noDiscount(), 0);
        if (first + second > amount) {
            vm.expectRevert();
            ledger.settle(inv, sig, second, _noDiscount(), 0);
        } else {
            ledger.settle(inv, sig, second, _noDiscount(), 0);
        }
        vm.stopPrank();

        IInvoiceLedger.InvoiceState memory st = ledger.status(fp);
        assertLe(st.credited, st.total);
        assertEq(usdc.balanceOf(payout), st.credited);
    }

    function testFuzz_quote_paidNeverExceedsCredit(uint256 credit, uint16 bps) public view {
        credit = bound(credit, 1, type(uint128).max);
        bps = uint16(bound(bps, 0, ledger.MAX_DISCOUNT_BPS()));
        Invoice memory inv = _invoice(credit);
        bytes32 fp = ledger.fingerprint(inv);
        (uint256 paid,) = ledger.quote(inv, credit, _offer(fp, bps, uint64(block.timestamp), sealKey));
        assertLe(paid, credit);
        // discount never exceeds the signed rate
        assertGe(paid * 10_000, credit * (10_000 - uint256(bps)));
    }

    function testFuzz_settle_worksWith18Decimals(uint256 amount) public {
        amount = bound(amount, 1, 1e36);
        token18.mint(payer, amount);
        vm.prank(payer);
        token18.approve(address(ledger), amount);

        Invoice memory inv = _invoice(amount);
        inv.token = address(token18);
        bytes memory sig = _signInvoice(inv, sealKey);
        vm.prank(payer);
        ledger.settle(inv, sig, amount, _noDiscount(), 0);
        assertEq(token18.balanceOf(payout), amount);
    }
}
