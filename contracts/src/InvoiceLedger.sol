// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SealSignature} from "./libraries/SealSignature.sol";

// Types
import {
    Invoice,
    EarlyPayOffer,
    Cancel,
    CreditNote,
    DiscountKind,
    DiscountProof,
    SealTypes
} from "./types/SealTypes.sol";

// Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvoiceLedger} from "./interfaces/IInvoiceLedger.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";

// Contracts
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title InvoiceLedger
/// @notice Permanent, ownerless record of sealed invoices. The only path that marks an invoice paid is `settle`,
/// which delivers the funds itself.
// INVARIANT: for every fingerprint, credited <= total
// INVARIANT: every unit of `credited` was matched by `paid` delivered to the Seal-signed payout, plus a discount the
//            Seal signed
contract InvoiceLedger is IInvoiceLedger, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SealTypes for *;

    uint16 public constant MAX_DISCOUNT_BPS = 5_000;
    uint16 private constant BPS_DENOMINATOR = 10_000;
    // CCTP V2 "standard" (finalized) transfer; fast transfers are a payer-side choice left for a later version
    uint32 private constant CCTP_STANDARD_FINALITY = 2_000;

    ITokenMessengerV2 public immutable tokenMessenger;
    uint32 public immutable localDomain;

    mapping(bytes32 fingerprint => InvoiceState) internal _invoices;
    mapping(bytes32 noteDigest => bool used) internal _usedCreditNotes;
    // replacements can name an invoice the ledger hasn't seen; the cancellation binds only if that Seal signed it
    mapping(bytes32 fingerprint => mapping(address seal => bool)) internal _preCancelledBy;

    /// @param tokenMessenger_ CCTP V2 TokenMessenger on this chain, or zero to disable cross-domain payouts
    /// @param localDomain_ This chain's CCTP domain (Arc: 26)
    constructor(address tokenMessenger_, uint32 localDomain_) EIP712("Symbolon", "1") {
        tokenMessenger = ITokenMessengerV2(tokenMessenger_);
        localDomain = localDomain_;
    }

    /// @inheritdoc IInvoiceLedger
    function settle(
        Invoice calldata inv,
        bytes calldata sealSig,
        uint256 credit,
        DiscountProof calldata discount,
        uint256 maxFee
    ) external nonReentrant returns (uint256 paid) {
        bytes32 fp = _verifyInvoice(inv, sealSig);
        InvoiceState storage state = _load(fp, inv);

        if (state.cancelled) revert InvoiceCancelled(fp);
        if (credit == 0) revert ZeroCredit();
        uint256 outstanding = state.total - state.credited;
        if (credit > outstanding) revert OverCredit(fp, outstanding, credit);
        if (inv.payoutAddress == address(0)) revert ZeroPayoutAddress();

        if (inv.replaces != bytes32(0)) _cancelReplaced(inv.replaces, inv.seal, fp);

        uint16 discountBps = _discountBps(inv, fp, discount);
        paid = _applyDiscount(credit, discountBps);

        state.credited += credit;

        // event is emitted before the token calls so it stays ordered ahead of any events they emit
        emit Settled(
            fp, inv.seal, msg.sender, inv.token, credit, paid, discountBps, inv.payoutDomain, inv.payoutAddress
        );

        _deliver(inv, paid, maxFee);
    }

    /// @inheritdoc IInvoiceLedger
    function cancel(Invoice calldata inv, bytes calldata sealSig, bytes calldata cancelSig) external {
        bytes32 fp = _verifyInvoice(inv, sealSig);
        InvoiceState storage state = _load(fp, inv);

        bytes32 cancelDigest = _hashTypedDataV4(Cancel({fingerprint: fp}).hash());
        if (!SealSignature.isValid(inv.seal, cancelDigest, cancelSig)) revert InvalidCancelSignature();
        if (state.cancelled) revert InvoiceCancelled(fp);
        if (state.credited != 0) revert AlreadyPaidInPart(fp);

        state.cancelled = true;
        emit Cancelled(fp, inv.seal, bytes32(0));
    }

    /// @inheritdoc IInvoiceLedger
    function applyCreditNote(
        Invoice calldata inv,
        bytes calldata sealSig,
        CreditNote calldata note,
        bytes calldata noteSig
    ) external {
        bytes32 fp = _verifyInvoice(inv, sealSig);
        if (note.fingerprint != fp) revert CreditNoteWrongInvoice();

        bytes32 noteDigest = _hashTypedDataV4(note.hash());
        if (!SealSignature.isValid(inv.seal, noteDigest, noteSig)) revert InvalidCreditNoteSignature();
        if (_usedCreditNotes[noteDigest]) revert CreditNoteAlreadyUsed(noteDigest);

        InvoiceState storage state = _load(fp, inv);
        if (state.cancelled) revert InvoiceCancelled(fp);
        uint256 outstanding = state.total - state.credited;
        if (note.amount == 0 || note.amount > outstanding) {
            revert CreditNoteExceedsOutstanding(outstanding, note.amount);
        }

        _usedCreditNotes[noteDigest] = true;
        state.total -= note.amount;
        emit CreditNoteApplied(fp, noteDigest, note.amount, state.total);
    }

    /// @inheritdoc IInvoiceLedger
    function quote(Invoice calldata inv, uint256 credit, DiscountProof calldata discount)
        external
        view
        returns (uint256 paid, uint16 discountBps)
    {
        bytes32 fp = _hashTypedDataV4(inv.hash());
        discountBps = _discountBps(inv, fp, discount);
        paid = _applyDiscount(credit, discountBps);
    }

    /// @inheritdoc IInvoiceLedger
    function fingerprint(Invoice calldata inv) external view returns (bytes32) {
        return _hashTypedDataV4(inv.hash());
    }

    /// @inheritdoc IInvoiceLedger
    function status(bytes32 fp) external view returns (InvoiceState memory) {
        return _invoices[fp];
    }

    /// @inheritdoc IInvoiceLedger
    function remaining(bytes32 fp) external view returns (uint256) {
        InvoiceState storage state = _invoices[fp];
        if (!state.seen || state.cancelled) return 0;
        return state.total - state.credited;
    }

    /// @inheritdoc IInvoiceLedger
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IInvoiceLedger
    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    /// @notice Checks the Seal's signature over the invoice and returns its fingerprint
    function _verifyInvoice(Invoice calldata inv, bytes calldata sealSig) internal view returns (bytes32 fp) {
        fp = _hashTypedDataV4(inv.hash());
        if (!SealSignature.isValid(inv.seal, fp, sealSig)) revert InvalidSealSignature();
    }

    /// @notice Loads an invoice's state, initialising it on first sight
    /// @dev A replacement can pre-cancel an invoice the ledger hasn't seen yet. That cancellation is recorded per
    /// Seal and only binds if the original turns out to be signed by the same Seal, so one vendor can never cancel
    /// (or block the cancellation of) another vendor's invoice by naming it in `replaces`.
    function _load(bytes32 fp, Invoice calldata inv) internal returns (InvoiceState storage state) {
        state = _invoices[fp];
        if (state.seen) return state;
        state.seal = inv.seal;
        state.total = inv.amount;
        state.seen = true;
        if (_preCancelledBy[fp][inv.seal]) state.cancelled = true;
    }

    /// @notice Cancels the invoice a replacement supersedes, if it belongs to the same Seal and is unpaid
    function _cancelReplaced(bytes32 replaced, address seal, bytes32 replacedBy) internal {
        InvoiceState storage old = _invoices[replaced];
        if (!old.seen) {
            if (_preCancelledBy[replaced][seal]) return;
            _preCancelledBy[replaced][seal] = true;
            emit Cancelled(replaced, seal, replacedBy);
            return;
        }
        // a replacement naming another vendor's invoice is ignored rather than trusted
        if (old.seal != seal || old.cancelled) return;
        if (old.credited != 0) revert ReplacedInvoiceHasPayments(replaced);
        old.cancelled = true;
        emit Cancelled(replaced, seal, replacedBy);
    }

    /// @notice Validates a discount claim and returns its rate
    function _discountBps(Invoice calldata inv, bytes32 fp, DiscountProof calldata discount)
        internal
        view
        returns (uint16 bps)
    {
        if (discount.kind == DiscountKind.None) return 0;

        if (discount.kind == DiscountKind.Tier) {
            if (discount.tierIndex >= inv.earlyPay.length) revert InvalidDiscountTier(discount.tierIndex);
            if (block.timestamp > inv.earlyPay[discount.tierIndex].payBy) revert DiscountExpired();
            bps = inv.earlyPay[discount.tierIndex].discountBps;
        } else {
            if (block.timestamp > discount.offerValidUntil) revert DiscountExpired();
            bytes32 offerDigest = _hashTypedDataV4(
                EarlyPayOffer({fingerprint: fp, discountBps: discount.offerBps, validUntil: discount.offerValidUntil})
                    .hash()
            );
            if (!SealSignature.isValid(inv.seal, offerDigest, discount.offerSig)) revert InvalidOfferSignature();
            bps = discount.offerBps;
        }

        if (bps > MAX_DISCOUNT_BPS) revert DiscountTooLarge(bps);
    }

    /// @notice Delivers `paid` to the invoice's payout, locally or across CCTP
    function _deliver(Invoice calldata inv, uint256 paid, uint256 maxFee) internal {
        IERC20 token = IERC20(inv.token);

        if (inv.payoutDomain == localDomain) {
            if (maxFee != 0) revert FeeOnLocalPayout();
            token.safeTransferFrom(msg.sender, inv.payoutAddress, paid);
            return;
        }

        if (address(tokenMessenger) == address(0)) revert CrossChainDisabled();
        // CCTP deducts its fee from the burned amount on the destination, so burning paid + maxFee delivers >= paid
        uint256 burnAmount = paid + maxFee;
        token.safeTransferFrom(msg.sender, address(this), burnAmount);
        token.forceApprove(address(tokenMessenger), burnAmount);
        tokenMessenger.depositForBurn(
            burnAmount,
            inv.payoutDomain,
            bytes32(uint256(uint160(inv.payoutAddress))),
            inv.token,
            bytes32(0),
            maxFee,
            CCTP_STANDARD_FINALITY
        );
    }

    /// @notice Applies a discount to a credit. The discount rounds down, in the vendor's favour.
    function _applyDiscount(uint256 credit, uint16 discountBps) internal pure returns (uint256) {
        return credit - (credit * discountBps) / BPS_DENOMINATOR;
    }
}
