// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {
    Invoice,
    EarlyPayTier,
    EarlyPayOffer,
    Cancel,
    CreditNote,
    PayoutChange,
    SealRotation,
    Approval,
    DiscountKind,
    DiscountProof,
    SealTypes
} from "../../src/types/SealTypes.sol";
import {InvoiceLedger} from "../../src/InvoiceLedger.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockTokenMessenger} from "../mocks/MockTokenMessenger.sol";

/// @notice Shared fixtures and EIP-712 signing helpers
abstract contract SymbolonTest is Test {
    using SealTypes for *;

    uint32 internal constant ARC_DOMAIN = 26;
    uint32 internal constant REMOTE_DOMAIN = 6;
    uint256 internal constant ONE_USDC = 1e6;

    InvoiceLedger internal ledger;
    MockTokenMessenger internal messenger;
    MockERC20 internal usdc;
    MockERC20 internal token18;

    address internal seal;
    uint256 internal sealKey;
    address internal payout = makeAddr("payout");
    address internal payer = makeAddr("payer");

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        messenger = new MockTokenMessenger();
        ledger = new InvoiceLedger(address(messenger), ARC_DOMAIN);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        token18 = new MockERC20("Eighteen", "E18", 18);
        (seal, sealKey) = makeAddrAndKey("seal");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Builders
    // ---------------------------------------------------------------------------------------------------------------

    function _invoice(uint256 amount) internal view returns (Invoice memory inv) {
        inv.seal = seal;
        inv.token = address(usdc);
        inv.amount = amount;
        inv.issuedAt = uint64(block.timestamp);
        inv.dueDate = uint64(block.timestamp + 30 days);
        inv.payoutAddress = payout;
        inv.payoutDomain = ARC_DOMAIN;
        inv.payerRef = keccak256("acme");
        inv.invoiceNumberHash = keccak256("INV-0142");
        inv.documentHash = keccak256("document");
    }

    function _withCurve(Invoice memory inv) internal view returns (Invoice memory) {
        inv.earlyPay = new EarlyPayTier[](2);
        inv.earlyPay[0] = EarlyPayTier({payBy: uint64(block.timestamp + 3 days), discountBps: 150});
        inv.earlyPay[1] = EarlyPayTier({payBy: uint64(block.timestamp + 15 days), discountBps: 75});
        return inv;
    }

    function _noDiscount() internal pure returns (DiscountProof memory d) {
        d.kind = DiscountKind.None;
    }

    function _tier(uint256 index) internal pure returns (DiscountProof memory d) {
        d.kind = DiscountKind.Tier;
        d.tierIndex = index;
    }

    function _offer(bytes32 fp, uint16 bps, uint64 validUntil, uint256 key)
        internal
        view
        returns (DiscountProof memory d)
    {
        d.kind = DiscountKind.Offer;
        d.offerBps = bps;
        d.offerValidUntil = validUntil;
        d.offerSig = _sign(key, EarlyPayOffer({fingerprint: fp, discountBps: bps, validUntil: validUntil}).hash());
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Signing
    // ---------------------------------------------------------------------------------------------------------------

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ledger.hashTypedData(structHash));
        return abi.encodePacked(r, s, v);
    }

    function _signInvoice(Invoice memory inv, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ledger.fingerprint(inv));
        return abi.encodePacked(r, s, v);
    }

    function _signCancel(bytes32 fp, uint256 key) internal view returns (bytes memory) {
        return _sign(key, Cancel({fingerprint: fp}).hash());
    }

    function _signCreditNote(CreditNote memory note, uint256 key) internal view returns (bytes memory) {
        return _sign(key, _hashCreditNote(note));
    }

    function _signPayoutChange(PayoutChange memory change, uint256 key) internal view returns (bytes memory) {
        return _sign(
            key,
            keccak256(
                abi.encode(
                    SealTypes.PAYOUT_CHANGE_TYPEHASH, change.seal, change.newPayout, change.payoutDomain, change.nonce
                )
            )
        );
    }

    function _signRotation(SealRotation memory rotation, uint256 key) internal view returns (bytes memory) {
        return _sign(
            key,
            keccak256(abi.encode(SealTypes.SEAL_ROTATION_TYPEHASH, rotation.oldSeal, rotation.newSeal, rotation.nonce))
        );
    }

    function _signApproval(Approval memory approval, uint256 key) internal view returns (bytes memory) {
        return _sign(key, approval.hash());
    }

    function _hashCreditNote(CreditNote memory note) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(SealTypes.CREDIT_NOTE_TYPEHASH, note.fingerprint, note.amount, note.documentHash, note.nonce)
        );
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------------------------------------------------

    function _fundPayer(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(ledger), type(uint256).max);
    }
}
