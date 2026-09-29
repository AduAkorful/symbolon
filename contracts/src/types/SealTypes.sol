// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice One step of a vendor's standing Early Pay curve: `discountBps` applies if paid at or before `payBy`
struct EarlyPayTier {
    uint64 payBy;
    uint16 discountBps;
}

/// @notice The vendor's half of a payment. Signed in full by the vendor's Seal, including where to be paid.
/// @dev Line items and attachments live offchain in the canonical document committed to by `documentHash`
struct Invoice {
    address seal;
    address token;
    uint256 amount;
    uint64 issuedAt;
    uint64 dueDate;
    address payoutAddress;
    uint32 payoutDomain;
    bytes32 payerRef;
    bytes32 invoiceNumberHash;
    bytes32 poRef;
    bytes32 documentHash;
    bytes32 replaces;
    EarlyPayTier[] earlyPay;
}

/// @notice A cash-now discount the vendor signed for one specific invoice
struct EarlyPayOffer {
    bytes32 fingerprint;
    uint16 discountBps;
    uint64 validUntil;
}

/// @notice A vendor-signed cancellation of an unpaid invoice
struct Cancel {
    bytes32 fingerprint;
}

/// @notice A vendor-signed reduction of what an invoice is owed
struct CreditNote {
    bytes32 fingerprint;
    uint256 amount;
    bytes32 documentHash;
    uint64 nonce;
}

/// @notice A vendor-signed request to be paid at a new address
struct PayoutChange {
    address seal;
    address newPayout;
    uint32 payoutDomain;
    uint64 nonce;
}

/// @notice A handover from a vendor's old Seal key to a new one, signed by the old key
struct SealRotation {
    address oldSeal;
    address newSeal;
    uint64 nonce;
}

/// @notice An approver's or owner's sign-off on paying `credit` of an invoice from a specific Vault
struct Approval {
    address vault;
    bytes32 fingerprint;
    uint256 credit;
    uint64 deadline;
}

/// @notice How a payment claims an Early Pay discount
enum DiscountKind {
    None,
    Tier,
    Offer
}

/// @notice Evidence for the discount claimed on a settlement. `tierIndex` is used for `Tier`, the offer fields for `Offer`
struct DiscountProof {
    DiscountKind kind;
    uint256 tierIndex;
    uint16 offerBps;
    uint64 offerValidUntil;
    bytes offerSig;
}

/// @title SealTypes
/// @notice EIP-712 struct hashing for every type Symbolon signs. All types share the InvoiceLedger's domain.
library SealTypes {
    bytes32 internal constant EARLY_PAY_TIER_TYPEHASH = keccak256("EarlyPayTier(uint64 payBy,uint16 discountBps)");

    bytes32 internal constant INVOICE_TYPEHASH = keccak256(
        "Invoice(address seal,address token,uint256 amount,uint64 issuedAt,uint64 dueDate,address payoutAddress,"
        "uint32 payoutDomain,bytes32 payerRef,bytes32 invoiceNumberHash,bytes32 poRef,bytes32 documentHash,"
        "bytes32 replaces,EarlyPayTier[] earlyPay)EarlyPayTier(uint64 payBy,uint16 discountBps)"
    );

    bytes32 internal constant EARLY_PAY_OFFER_TYPEHASH =
        keccak256("EarlyPayOffer(bytes32 fingerprint,uint16 discountBps,uint64 validUntil)");

    bytes32 internal constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 fingerprint)");

    bytes32 internal constant CREDIT_NOTE_TYPEHASH =
        keccak256("CreditNote(bytes32 fingerprint,uint256 amount,bytes32 documentHash,uint64 nonce)");

    bytes32 internal constant PAYOUT_CHANGE_TYPEHASH =
        keccak256("PayoutChange(address seal,address newPayout,uint32 payoutDomain,uint64 nonce)");

    bytes32 internal constant SEAL_ROTATION_TYPEHASH =
        keccak256("SealRotation(address oldSeal,address newSeal,uint64 nonce)");

    bytes32 internal constant APPROVAL_TYPEHASH =
        keccak256("Approval(address vault,bytes32 fingerprint,uint256 credit,uint64 deadline)");

    function hash(Invoice calldata inv) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INVOICE_TYPEHASH,
                inv.seal,
                inv.token,
                inv.amount,
                inv.issuedAt,
                inv.dueDate,
                inv.payoutAddress,
                inv.payoutDomain,
                inv.payerRef,
                inv.invoiceNumberHash,
                inv.poRef,
                inv.documentHash,
                inv.replaces,
                _hashTiers(inv.earlyPay)
            )
        );
    }

    function hash(EarlyPayOffer memory offer) internal pure returns (bytes32) {
        return keccak256(abi.encode(EARLY_PAY_OFFER_TYPEHASH, offer.fingerprint, offer.discountBps, offer.validUntil));
    }

    function hash(Cancel memory c) internal pure returns (bytes32) {
        return keccak256(abi.encode(CANCEL_TYPEHASH, c.fingerprint));
    }

    function hash(CreditNote calldata note) internal pure returns (bytes32) {
        return keccak256(abi.encode(CREDIT_NOTE_TYPEHASH, note.fingerprint, note.amount, note.documentHash, note.nonce));
    }

    function hash(PayoutChange calldata change) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(PAYOUT_CHANGE_TYPEHASH, change.seal, change.newPayout, change.payoutDomain, change.nonce)
            );
    }

    function hash(SealRotation calldata rotation) internal pure returns (bytes32) {
        return keccak256(abi.encode(SEAL_ROTATION_TYPEHASH, rotation.oldSeal, rotation.newSeal, rotation.nonce));
    }

    function hash(Approval memory approval) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(APPROVAL_TYPEHASH, approval.vault, approval.fingerprint, approval.credit, approval.deadline)
        );
    }

    function _hashTiers(EarlyPayTier[] calldata tiers) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](tiers.length);
        for (uint256 i; i < tiers.length; ++i) {
            hashes[i] = keccak256(abi.encode(EARLY_PAY_TIER_TYPEHASH, tiers[i].payBy, tiers[i].discountBps));
        }
        // EIP-712 encodes an array as the concatenation of its members' 32-byte hashes; packing fixed-size words
        // has no ambiguity
        return keccak256(abi.encodePacked(hashes));
    }
}
