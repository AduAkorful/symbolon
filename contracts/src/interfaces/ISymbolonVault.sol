// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Invoice, DiscountProof, PayoutChange, SealRotation} from "../types/SealTypes.sol";

/// @title ISymbolonVault
/// @notice A business's treasury. Holds its funds and enforces the owner's payment rules, which the Steward operates
/// within but cannot change.
interface ISymbolonVault {
    /// @notice Screening result for a counterparty
    enum Risk {
        Low,
        Medium,
        High,
        Blocked
    }

    /// @notice Which human sign-off a payment needs
    enum ApprovalLevel {
        None,
        Approver,
        Owner
    }

    /// @notice The owner's payment rules. Amounts are in raw token units of the Vault's accounting decimals.
    /// @param perTxCap Largest single payment
    /// @param autoPayLimit Largest payment that needs no human approval
    /// @param ownerThreshold Payments above this need the owner's approval
    /// @param newVendorMinPaid Payments to a payee with fewer settlements than this need an approver
    /// @param screeningMaxAge Oldest acceptable screening result, in seconds (0 disables the requirement)
    /// @param newPayeeDelay Cooling-off before a newly added payee can be paid
    /// @param changeCooldown Cooling-off before a changed payout address or rotated Seal can be paid
    /// @param looseningDelay Delay before any change that loosens a rule takes effect
    /// @param maxBridgeFee Largest CCTP fee the Vault will fund on one cross-chain payout
    struct Policy {
        uint256 perTxCap;
        uint256 autoPayLimit;
        uint256 ownerThreshold;
        uint32 newVendorMinPaid;
        uint64 screeningMaxAge;
        uint64 newPayeeDelay;
        uint64 changeCooldown;
        uint64 looseningDelay;
        uint256 maxBridgeFee;
    }

    /// @notice How much of the Vault may sit in USYC. Only for Vaults Circle has allowlisted for USYC.
    /// @param enabled Whether the Steward or owner may move cash into USYC
    /// @param maxReserveBps Largest share of (USDC + USYC value) that may be held in USYC after a subscription
    /// @param minOperating USDC that must stay in the Vault after a subscription
    struct ReservePolicy {
        bool enabled;
        uint16 maxReserveBps;
        uint256 minOperating;
    }

    /// @notice How the business deals with one payee
    /// @param budget Budget the payee's invoices are charged to (bytes32(0) is the operating budget)
    /// @param requirePo Every invoice must reference an open purchase order
    /// @param requireDelivery Every invoice needs a requester's delivery confirmation
    /// @param monthlyCap Most that can be paid to this payee in a 30-day period
    struct PayeeTerms {
        bytes32 budget;
        bool requirePo;
        bool requireDelivery;
        uint256 monthlyCap;
    }

    /// @notice A verified vendor, keyed by its Seal
    struct Payee {
        bool exists;
        uint32 paidCount;
        address payout;
        uint32 payoutDomain;
        uint64 activeAt;
        uint64 retireAt;
        uint64 lastChangeNonce;
        address pendingPayout;
        uint32 pendingDomain;
        uint64 pendingActiveAt;
        Risk risk;
        uint64 screenedAt;
        uint64 spendPeriod;
        uint256 spentInPeriod;
        PayeeTerms terms;
    }

    /// @notice A spending budget with a rolling fixed-length period
    struct Budget {
        bool exists;
        uint64 periodLength;
        uint64 periodIndex;
        uint256 cap;
        uint256 spent;
    }

    /// @notice What was ordered from a vendor, and how much can still be invoiced against it
    struct PurchaseOrder {
        bool open;
        address seal;
        uint64 releaseAfter;
        bytes32 budget;
        uint256 remaining;
    }

    /// @notice One payment request from the Steward, an approver or the owner
    /// @param invoice The sealed invoice
    /// @param sealSig The Seal's signature over the invoice
    /// @param credit Gross amount of the invoice to settle
    /// @param discount Evidence for any Early Pay discount
    /// @param maxFee CCTP fee to fund for a cross-chain payout (0 for local)
    /// @param decisionHash Hash of the decision record behind this payment
    struct PayParams {
        Invoice invoice;
        bytes sealSig;
        uint256 credit;
        DiscountProof discount;
        uint256 maxFee;
        bytes32 decisionHash;
    }

    /// @notice An approver's or owner's EIP-712 `Approval` for this payment
    struct SignedApproval {
        address signer;
        uint64 deadline;
        bytes signature;
    }

    event Paid(
        bytes32 indexed fingerprint,
        address indexed seal,
        address indexed caller,
        uint256 credit,
        uint256 paid,
        bytes32 budget,
        bytes32 decisionHash
    );
    event DecisionsAnchored(bytes32 indexed root, uint256 count);
    event PayeeAdded(address indexed seal, address payout, uint32 payoutDomain, uint64 activeAt, PayeeTerms terms);
    event PayeeTermsUpdated(address indexed seal, PayeeTerms terms);
    event PayeeRemoved(address indexed seal);
    event PayoutChangeConfirmed(address indexed seal, address newPayout, uint32 payoutDomain, uint64 activeAt);
    event PayoutChangeCancelled(address indexed seal);
    event SealRotationConfirmed(address indexed oldSeal, address indexed newSeal, uint64 activeAt);
    event ScreeningSet(address indexed seal, Risk risk, uint64 screenedAt);
    event DeliveryConfirmed(bytes32 indexed fingerprint, address indexed by);
    event DeliveryRejected(bytes32 indexed fingerprint, address indexed by, bytes32 reasonHash);
    event PurchaseOrderOpened(
        bytes32 indexed poRef, address indexed seal, bytes32 budget, uint256 amount, uint64 releaseAfter
    );
    event PurchaseOrderClosed(bytes32 indexed poRef);
    event BudgetSet(bytes32 indexed budget, uint256 cap, uint64 periodLength);
    event PolicySet(Policy policy);
    event StewardSet(address indexed steward);
    event ApproverSet(address indexed approver, bytes32 indexed budget, bool enabled);
    event RequesterSet(address indexed requester, bool enabled);
    event ScreenerSet(address indexed screener);
    event SupportedTokenSet(address indexed token, bool supported);
    event ChangeQueued(bytes32 indexed changeId, bytes4 indexed selector, uint64 eta);
    event ChangeCancelled(bytes32 indexed changeId);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event UpgradeScheduled(address indexed implementation, uint64 readyAt);
    event UpgradeCancelled(address indexed implementation);
    event AutoUpdateSet(bool enabled);
    event ReservePolicySet(ReservePolicy policy);
    event ReserveSubscribed(address indexed caller, uint256 assets, uint256 shares, bytes32 decisionHash);
    event ReserveRedeemed(address indexed caller, uint256 shares, uint256 assets, bytes32 decisionHash);

    error VaultPaused();
    error NotPayer();
    error NotSteward();
    error NotRequester();
    error NotScreener();
    error UnsupportedToken(address token);
    error UnknownPayee(address seal);
    error PayeeNotActive(address seal, uint64 activeAt);
    error PayeeRetired(address seal);
    error PayoutMismatch(address expected, uint32 expectedDomain);
    error PayeeBlocked(address seal);
    error ScreeningStale(address seal, uint64 screenedAt);
    error PurchaseOrderRequired();
    error PurchaseOrderNotOpen(bytes32 poRef);
    error PurchaseOrderWrongVendor(bytes32 poRef);
    error PurchaseOrderNotReleased(bytes32 poRef, uint64 releaseAfter);
    error PurchaseOrderExceeded(bytes32 poRef, uint256 remaining);
    error DeliveryNotConfirmed(bytes32 fingerprint);
    error PerTxCapExceeded(uint256 cap, uint256 paid);
    error PayeeCapExceeded(uint256 cap, uint256 spent, uint256 paid);
    error BudgetExceeded(bytes32 budget, uint256 cap, uint256 spent, uint256 paid);
    error UnknownBudget(bytes32 budget);
    error BridgeFeeTooHigh(uint256 maxBridgeFee, uint256 maxFee);
    error ApprovalRequired(ApprovalLevel required);
    error ApprovalExpired(address signer);
    error InvalidApproval(address signer);
    error SettlementMismatch(uint256 quoted, uint256 settled);
    error PayeeExists(address seal);
    error InvalidSealSignature();
    error StaleNonce(uint64 lastNonce, uint64 nonce);
    error NoPendingPayoutChange(address seal);
    error ChangeNotReady(bytes32 changeId, uint64 eta);
    error UnknownChange(bytes32 changeId);
    error StewardCannotHoldRole(address account);
    error InvalidScreeningTime();
    error ZeroAddress();
    error TokenDecimalsMismatch(address token, uint8 decimals);
    error InvalidPeriod();
    error UpgradeNotScheduled(address implementation);
    error UpgradeNotReady(address implementation, uint64 readyAt);
    error UpgradeAlreadyScheduled(address implementation);
    error AutoUpdateOff();
    error ReleaseNotPublished(address implementation);
    error ReserveDisabled();
    error ReserveNotEntitled();
    error InvalidReservePolicy();
    error NotTreasurer();
    error ReserveSlippage(uint256 minimum, uint256 received);
    error OperatingFloor(uint256 minOperating, uint256 remaining);
    error ReserveShareExceeded(uint256 maxReserveBps, uint256 reserveValue, uint256 total);
    error UsycNotPayable();

    /// @notice Pays part or all of a sealed invoice, subject to every rule in the policy
    /// @return paid Amount delivered to the vendor
    function pay(PayParams calldata params, SignedApproval[] calldata approvals) external returns (uint256 paid);

    /// @notice Anchors a batch of decision records that produced no payment
    function anchorDecisions(bytes32 root, uint256 count) external;

    /// @notice Records that the work or goods behind an invoice arrived
    function confirmDelivery(bytes32 fp) external;

    /// @notice Records that a delivery was rejected, so the invoice is held
    function rejectDelivery(bytes32 fp, bytes32 reasonHash) external;

    /// @notice Records a screening result for a payee
    function setScreening(address seal, Risk risk, uint64 screenedAt) external;

    /// @notice Adds a vendor the owner verified out of band. Payable after the new-payee delay.
    function addPayee(address seal, address payout, uint32 payoutDomain, PayeeTerms calldata terms) external;

    /// @notice Changes how a payee is handled. Loosening changes are queued.
    function updatePayeeTerms(address seal, PayeeTerms calldata terms) external;

    /// @notice Removes a payee immediately
    function removePayee(address seal) external;

    /// @notice Confirms a vendor-signed payout change; the new address becomes payable after the cooldown
    function confirmPayoutChange(PayoutChange calldata change, bytes calldata sig) external;

    /// @notice Cancels a payout change that hasn't cleared
    function cancelPayoutChange(address seal) external;

    /// @notice Confirms a Seal rotation signed by the old Seal; the new Seal becomes payable after the cooldown
    function confirmSealRotation(SealRotation calldata rotation, bytes calldata sig) external;

    /// @notice Opens a purchase order against which invoices can be matched
    function openPurchaseOrder(bytes32 poRef, address seal, bytes32 budget, uint256 amount, uint64 releaseAfter)
        external;

    /// @notice Closes a purchase order
    function closePurchaseOrder(bytes32 poRef) external;

    /// @notice Sets a budget's cap and period. Raising a cap or shortening a period is queued.
    function setBudget(bytes32 budget, uint256 cap, uint64 periodLength) external;

    /// @notice Replaces the policy. Tightening applies now; any loosening is queued.
    function setPolicy(Policy calldata newPolicy) external;

    /// @notice Sets the Steward. Revoking (zero) applies now; appointing is queued.
    function setSteward(address newSteward) external;

    /// @notice Grants or revokes approval authority over a budget. Granting is queued.
    function setApprover(address approver, bytes32 budget, bool enabled) external;

    /// @notice Grants or revokes the requester role. Granting is queued.
    function setRequester(address requester, bool enabled) external;

    /// @notice Sets the screening role. Clearing applies now; appointing is queued.
    function setScreener(address newScreener) external;

    /// @notice Enables or disables a payment token. Enabling is queued.
    function setSupportedToken(address token, bool supported) external;

    /// @notice Cancels a queued loosening change
    function cancelQueuedChange(bytes32 id) external;

    /// @notice Freezes all outgoing payments
    function pause() external;

    /// @notice Resumes payments
    function unpause() external;

    /// @notice Schedules an upgrade to `newImplementation`, allowed after the loosening delay
    function scheduleUpgrade(address newImplementation) external;

    /// @notice Drops a scheduled upgrade, manual or automatic
    function cancelUpgrade(address newImplementation) external;

    /// @notice Opts in to (queued) or out of (immediate) following Symbolon's published releases
    function setAutoUpdate(bool enabled) external;

    /// @notice Schedules a published release on an auto-updating Vault. Callable by anyone.
    function scheduleRelease(address newImplementation) external;

    /// @notice Applies a matured, still-published release on a Vault that still has auto-update on. Callable by anyone.
    function applyRelease(address newImplementation) external;

    /// @notice Withdraws funds to the owner's chosen address
    function withdraw(address token, address to, uint256 amount) external;

    /// @notice Sets how much of the Vault may be held in USYC. Owner only. Enabling, a higher `maxReserveBps` and a
    /// lower `minOperating` are loosening changes (delayed); enabling also requires Circle to have allowlisted this
    /// Vault for USYC.
    function setReservePolicy(ReservePolicy calldata policy) external;

    /// @notice Moves `assets` of USDC into USYC held by this Vault. Steward or owner; not while paused.
    /// @param minShares Least USYC the Vault must receive (measured by its balance, not the Teller's return value)
    /// @param decisionHash The Steward's decision record for this move
    function subscribeReserve(uint256 assets, uint256 minShares, bytes32 decisionHash) external returns (uint256 shares);

    /// @notice Redeems `shares` of USYC back to USDC in this Vault. Steward (not while paused) or owner (always), even
    /// with the reserve disabled, so a business can always return to cash.
    /// @param minAssets Least USDC the Vault must receive (measured by its balance)
    function redeemReserve(uint256 shares, uint256 minAssets, bytes32 decisionHash) external returns (uint256 assets);
}
