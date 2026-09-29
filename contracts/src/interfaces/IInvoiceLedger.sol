// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Invoice, CreditNote, DiscountProof} from "../types/SealTypes.sol";

/// @title IInvoiceLedger
/// @notice The permanent, permissionless record of what every sealed invoice is owed and has been paid.
/// Settling through the ledger is the only way an invoice is marked paid, and the ledger itself delivers the funds
/// to the payout address the vendor's Seal signed, so "credited" always means the vendor was actually paid.
interface IInvoiceLedger {
    /// @notice What the ledger knows about one invoice fingerprint
    /// @param seal The Seal that signed the invoice (zero until first seen)
    /// @param total What the invoice is owed, after credit notes
    /// @param credited How much of `total` has been settled, gross of Early Pay discounts
    /// @param cancelled True once the invoice can never be paid again
    /// @param seen True once the full invoice has been presented to the ledger
    struct InvoiceState {
        address seal;
        uint256 total;
        uint256 credited;
        bool cancelled;
        bool seen;
    }

    /// @notice Emitted when part or all of an invoice is settled
    /// @param fingerprint The invoice's EIP-712 digest
    /// @param seal The vendor's Seal
    /// @param payer Who funded the settlement
    /// @param token The token paid
    /// @param credit Gross amount of the invoice settled
    /// @param paid Amount delivered to the vendor (credit less discount)
    /// @param discountBps Early Pay discount applied, in basis points
    /// @param payoutDomain CCTP domain the payment was delivered to
    /// @param payoutAddress Address the payment was delivered to
    event Settled(
        bytes32 indexed fingerprint,
        address indexed seal,
        address indexed payer,
        address token,
        uint256 credit,
        uint256 paid,
        uint16 discountBps,
        uint32 payoutDomain,
        address payoutAddress
    );

    /// @notice Emitted when an invoice is cancelled, by the vendor or by a replacement invoice
    event Cancelled(bytes32 indexed fingerprint, address indexed seal, bytes32 replacedBy);

    /// @notice Emitted when a credit note reduces an invoice's total
    event CreditNoteApplied(bytes32 indexed fingerprint, bytes32 indexed noteDigest, uint256 amount, uint256 newTotal);

    error InvalidSealSignature();
    error InvoiceCancelled(bytes32 fingerprint);
    error ZeroCredit();
    error OverCredit(bytes32 fingerprint, uint256 remaining, uint256 credit);
    error ReplacedInvoiceHasPayments(bytes32 replaced);
    error InvalidDiscountTier(uint256 tierIndex);
    error DiscountExpired();
    error DiscountTooLarge(uint16 discountBps);
    error InvalidOfferSignature();
    error AlreadyPaidInPart(bytes32 fingerprint);
    error CreditNoteAlreadyUsed(bytes32 noteDigest);
    error CreditNoteWrongInvoice();
    error CreditNoteExceedsOutstanding(uint256 outstanding, uint256 amount);
    error InvalidCancelSignature();
    error InvalidCreditNoteSignature();
    error CrossChainDisabled();
    error FeeOnLocalPayout();
    error ZeroPayoutAddress();

    /// @notice Settles `credit` of an invoice, delivering `paid = credit - discount` to the signed payout address
    /// @dev Pulls funds from the caller. For a payout on another CCTP domain, pulls `paid + maxFee` and burns it so
    /// the vendor receives at least `paid` after the destination fee.
    /// @param inv The sealed invoice
    /// @param sealSig The Seal's EIP-712 signature over `inv`
    /// @param credit Gross amount of the invoice being settled
    /// @param discount Evidence for any Early Pay discount claimed
    /// @param maxFee Maximum CCTP fee for a cross-domain payout; must be 0 for a local payout
    /// @return paid The amount delivered to the vendor
    function settle(
        Invoice calldata inv,
        bytes calldata sealSig,
        uint256 credit,
        DiscountProof calldata discount,
        uint256 maxFee
    ) external returns (uint256 paid);

    /// @notice Cancels an unpaid invoice with the vendor's signed `Cancel`
    function cancel(Invoice calldata inv, bytes calldata sealSig, bytes calldata cancelSig) external;

    /// @notice Reduces an invoice's total with the vendor's signed credit note
    function applyCreditNote(
        Invoice calldata inv,
        bytes calldata sealSig,
        CreditNote calldata note,
        bytes calldata noteSig
    ) external;

    /// @notice Computes what settling `credit` would deliver, validating the discount claim but not moving funds
    /// @return paid Amount the vendor would receive
    /// @return discountBps Discount that would apply
    function quote(Invoice calldata inv, uint256 credit, DiscountProof calldata discount)
        external
        view
        returns (uint256 paid, uint16 discountBps);

    /// @notice The invoice's fingerprint: its EIP-712 digest under the ledger's domain
    function fingerprint(Invoice calldata inv) external view returns (bytes32);

    /// @notice The ledger's state for a fingerprint
    function status(bytes32 fp) external view returns (InvoiceState memory);

    /// @notice What is still owed on a fingerprint (0 if cancelled). Unseen invoices report 0.
    function remaining(bytes32 fp) external view returns (uint256);

    /// @notice The EIP-712 domain separator shared by every Symbolon signed type
    function domainSeparator() external view returns (bytes32);

    /// @notice Returns the EIP-712 digest of a struct hash under the ledger's domain
    function hashTypedData(bytes32 structHash) external view returns (bytes32);

    /// @notice The CCTP domain of this chain
    function localDomain() external view returns (uint32);

    /// @notice The largest Early Pay discount the ledger accepts, in basis points
    function MAX_DISCOUNT_BPS() external view returns (uint16);
}
