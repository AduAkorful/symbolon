// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReserveLogic} from "./libraries/ReserveLogic.sol";
import {SealSignature} from "./libraries/SealSignature.sol";
import {VaultStorage, VaultStorageLib} from "./libraries/VaultStorage.sol";

// Types
import {Invoice, PayoutChange, SealRotation, Approval, SealTypes} from "./types/SealTypes.sol";

// Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IInvoiceLedger} from "./interfaces/IInvoiceLedger.sol";
import {IReleaseRegistry} from "./interfaces/IReleaseRegistry.sol";
import {ISymbolonVault} from "./interfaces/ISymbolonVault.sol";
import {IUsycTeller} from "./interfaces/IUsycTeller.sol";

// Contracts
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Extsload} from "./Extsload.sol";

/// @title SymbolonVault
/// @notice A business's treasury on Arc. The Steward proposes payments; this contract decides.
/// @dev Deployed behind an ERC-1967 proxy. Only the business owner can upgrade it, after scheduling the new
/// implementation and waiting out the Vault's loosening delay (or, if the owner opted in, a published release after
/// the same delay). All state lives in ERC-7201 namespaced storage; reads are served by `VaultLens` via `extsload`.
// INVARIANT: funds leave only through `pay` (to a Seal-signed, owner-confirmed, cooled-off payout via the ledger)
//            or `withdraw` (owner); reserve moves swap USDC and USYC through the Teller with this Vault as receiver
// TRUST: `usycTeller` is Circle's (upgradeable by Circle); reserve moves rely on it and are bounded by min-out checks
// INVARIANT: the steward can never hold the owner, approver, requester or screener role
// INVARIANT: any change that loosens a rule, including an upgrade, waits `policy.looseningDelay` before it applies
contract SymbolonVault is
    ISymbolonVault,
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard,
    Extsload
{
    using SafeERC20 for IERC20;
    using SealTypes for *;

    bytes32 public constant OPERATING_BUDGET = bytes32(0);
    uint64 private constant PAYEE_PERIOD = 30 days;
    uint64 private constant DEFAULT_BUDGET_PERIOD = 30 days;

    IInvoiceLedger public immutable ledger;
    IReleaseRegistry public immutable releaseRegistry;
    /// @notice Circle's USYC Teller on this chain, or zero where USYC isn't available
    IUsycTeller public immutable usycTeller;
    IERC20 private immutable _usyc;
    IERC20 private immutable _reserveAsset;
    bytes32 private immutable _domainSeparator;

    modifier onlyPayer() {
        VaultStorage storage $ = _s();
        if (msg.sender != $.steward && msg.sender != owner() && !_isAnyApprover(msg.sender)) revert NotPayer();
        _;
    }

    modifier onlySteward() {
        if (msg.sender != _s().steward) revert NotSteward();
        _;
    }

    /// @param ledger_ The InvoiceLedger every Vault behind this implementation settles through
    /// @param releaseRegistry_ Symbolon's release registry, followed only by Vaults that opt in to auto-update
    /// @param usycTeller_ Circle's USYC Teller, or zero on chains without USYC (the reserve then stays off)
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IInvoiceLedger ledger_, IReleaseRegistry releaseRegistry_, IUsycTeller usycTeller_) {
        if (address(ledger_) == address(0) || address(releaseRegistry_) == address(0)) revert ZeroAddress();
        ledger = ledger_;
        releaseRegistry = releaseRegistry_;
        usycTeller = usycTeller_;
        bool hasUsyc = address(usycTeller_) != address(0);
        _usyc = IERC20(hasUsyc ? usycTeller_.share() : address(0));
        _reserveAsset = IERC20(hasUsyc ? usycTeller_.asset() : address(0));
        _domainSeparator = ledger_.domainSeparator();
        _disableInitializers();
    }

    /// @notice Sets up a new Vault behind its proxy
    /// @param owner_ The business owner
    /// @param steward_ The Steward's address (zero to start without one)
    /// @param policy_ Initial policy
    /// @param tokens Initially supported payment tokens; all must share `accountingDecimals_`
    /// @param accountingDecimals_ Decimals every policy amount is denominated in
    /// @param autoUpdate_ Whether the owner chose to follow Symbolon's published releases
    function initialize(
        address owner_,
        address steward_,
        Policy calldata policy_,
        address[] calldata tokens,
        uint8 accountingDecimals_,
        bool autoUpdate_
    ) external initializer {
        if (steward_ == owner_) revert StewardCannotHoldRole(steward_);
        __Ownable_init(owner_);
        __Ownable2Step_init();

        VaultStorage storage $ = _s();
        $.accountingDecimals = accountingDecimals_;
        $.autoUpdate = autoUpdate_;
        emit AutoUpdateSet(autoUpdate_);

        $.policy = policy_;
        emit PolicySet(policy_);

        $.steward = steward_;
        emit StewardSet(steward_);

        $.budgets[OPERATING_BUDGET] = Budget({
            exists: true, periodLength: DEFAULT_BUDGET_PERIOD, periodIndex: 0, cap: type(uint256).max, spent: 0
        });
        emit BudgetSet(OPERATING_BUDGET, type(uint256).max, DEFAULT_BUDGET_PERIOD);

        for (uint256 i; i < tokens.length; ++i) {
            _checkDecimals(tokens[i]);
            $.isSupportedToken[tokens[i]] = true;
            emit SupportedTokenSet(tokens[i], true);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Payments
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function pay(PayParams calldata params, SignedApproval[] calldata approvals)
        external
        nonReentrant
        onlyPayer
        returns (uint256 paid)
    {
        if (_s().paused) revert VaultPaused();
        Invoice calldata inv = params.invoice;
        if (!_s().isSupportedToken[inv.token]) revert UnsupportedToken(inv.token);
        if (params.maxFee > _s().policy.maxBridgeFee) revert BridgeFeeTooHigh(_s().policy.maxBridgeFee, params.maxFee);

        Payee storage p = _activePayee(inv);
        // same digest the ledger computes: the Vault caches the ledger's domain separator at construction
        bytes32 fp = _digest(inv.hash());

        bytes32 budgetId = p.terms.budget;
        if (p.terms.requirePo || _s().purchaseOrders[inv.poRef].seal != address(0)) {
            budgetId = _matchPurchaseOrder(inv, params.credit);
        }
        if (p.terms.requireDelivery && !_s().deliveryConfirmed[fp]) revert DeliveryNotConfirmed(fp);

        (paid,) = ledger.quote(inv, params.credit, params.discount);
        uint256 outflow = paid + params.maxFee;
        _checkLimits(p, budgetId, outflow);
        _checkApprovals(p, budgetId, fp, params.credit, outflow, approvals);

        p.paidCount += 1;

        emit Paid(fp, inv.seal, msg.sender, params.credit, paid, budgetId, params.decisionHash);

        IERC20 token = IERC20(inv.token);
        token.forceApprove(address(ledger), outflow);
        uint256 settled = ledger.settle(inv, params.sealSig, params.credit, params.discount, params.maxFee);
        token.forceApprove(address(ledger), 0);
        if (settled != paid) revert SettlementMismatch(paid, settled);
    }

    /// @inheritdoc ISymbolonVault
    function anchorDecisions(bytes32 root, uint256 count) external onlySteward {
        emit DecisionsAnchored(root, count);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Matching and screening inputs
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function confirmDelivery(bytes32 fp) external {
        if (!_s().isRequester[msg.sender] && msg.sender != owner()) revert NotRequester();
        _s().deliveryConfirmed[fp] = true;
        emit DeliveryConfirmed(fp, msg.sender);
    }

    /// @inheritdoc ISymbolonVault
    function rejectDelivery(bytes32 fp, bytes32 reasonHash) external {
        if (!_s().isRequester[msg.sender] && msg.sender != owner()) revert NotRequester();
        _s().deliveryConfirmed[fp] = false;
        emit DeliveryRejected(fp, msg.sender, reasonHash);
    }

    /// @inheritdoc ISymbolonVault
    function setScreening(address seal, Risk risk, uint64 screenedAt) external {
        VaultStorage storage $ = _s();
        if (msg.sender != $.screener && msg.sender != owner()) revert NotScreener();
        if (!$.payees[seal].exists) revert UnknownPayee(seal);
        if (screenedAt > block.timestamp) revert InvalidScreeningTime();
        $.payees[seal].risk = risk;
        $.payees[seal].screenedAt = screenedAt;
        emit ScreeningSet(seal, risk, screenedAt);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Payees and change control
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function addPayee(address seal, address payout, uint32 payoutDomain, PayeeTerms calldata terms) external onlyOwner {
        VaultStorage storage $ = _s();
        if (seal == address(0) || payout == address(0)) revert ZeroAddress();
        if ($.payees[seal].exists) revert PayeeExists(seal);
        if (!$.budgets[terms.budget].exists) revert UnknownBudget(terms.budget);

        uint64 activeAt = uint64(block.timestamp) + $.policy.newPayeeDelay;
        Payee storage p = $.payees[seal];
        p.exists = true;
        p.payout = payout;
        p.payoutDomain = payoutDomain;
        p.activeAt = activeAt;
        p.terms = terms;
        emit PayeeAdded(seal, payout, payoutDomain, activeAt, terms);
    }

    /// @inheritdoc ISymbolonVault
    function updatePayeeTerms(address seal, PayeeTerms calldata terms) external onlyOwner {
        VaultStorage storage $ = _s();
        Payee storage p = $.payees[seal];
        if (!p.exists) revert UnknownPayee(seal);
        if (!$.budgets[terms.budget].exists) revert UnknownBudget(terms.budget);

        PayeeTerms memory current = p.terms;
        bool loosening = terms.budget != current.budget || (current.requirePo && !terms.requirePo)
            || (current.requireDelivery && !terms.requireDelivery) || terms.monthlyCap > current.monthlyCap;
        if (!_gate(loosening)) return;

        p.terms = terms;
        emit PayeeTermsUpdated(seal, terms);
    }

    /// @inheritdoc ISymbolonVault
    function removePayee(address seal) external onlyOwner {
        if (!_s().payees[seal].exists) revert UnknownPayee(seal);
        delete _s().payees[seal];
        emit PayeeRemoved(seal);
    }

    /// @inheritdoc ISymbolonVault
    function confirmPayoutChange(PayoutChange calldata change, bytes calldata sig) external onlyOwner {
        VaultStorage storage $ = _s();
        Payee storage p = $.payees[change.seal];
        if (!p.exists) revert UnknownPayee(change.seal);
        if (change.newPayout == address(0)) revert ZeroAddress();
        if (change.nonce <= p.lastChangeNonce) revert StaleNonce(p.lastChangeNonce, change.nonce);
        if (!SealSignature.isValid(change.seal, _digest(change.hash()), sig)) revert InvalidSealSignature();

        _applyClearedPayoutChange(p);
        uint64 activeAt = uint64(block.timestamp) + $.policy.changeCooldown;
        p.lastChangeNonce = change.nonce;
        p.pendingPayout = change.newPayout;
        p.pendingDomain = change.payoutDomain;
        p.pendingActiveAt = activeAt;
        emit PayoutChangeConfirmed(change.seal, change.newPayout, change.payoutDomain, activeAt);
    }

    /// @inheritdoc ISymbolonVault
    function cancelPayoutChange(address seal) external onlyOwner {
        Payee storage p = _s().payees[seal];
        // a change whose cooldown has passed is already the active address and can't be cancelled here
        if (p.pendingActiveAt == 0 || block.timestamp >= p.pendingActiveAt) revert NoPendingPayoutChange(seal);
        p.pendingPayout = address(0);
        p.pendingDomain = 0;
        p.pendingActiveAt = 0;
        emit PayoutChangeCancelled(seal);
    }

    /// @inheritdoc ISymbolonVault
    function confirmSealRotation(SealRotation calldata rotation, bytes calldata sig) external onlyOwner {
        VaultStorage storage $ = _s();
        Payee storage old = $.payees[rotation.oldSeal];
        if (!old.exists) revert UnknownPayee(rotation.oldSeal);
        if (rotation.newSeal == address(0)) revert ZeroAddress();
        if ($.payees[rotation.newSeal].exists) revert PayeeExists(rotation.newSeal);
        if (rotation.nonce <= old.lastChangeNonce) revert StaleNonce(old.lastChangeNonce, rotation.nonce);
        if (!SealSignature.isValid(rotation.oldSeal, _digest(rotation.hash()), sig)) revert InvalidSealSignature();

        _applyClearedPayoutChange(old);
        uint64 activeAt = uint64(block.timestamp) + $.policy.changeCooldown;
        old.lastChangeNonce = rotation.nonce;
        old.retireAt = activeAt;

        Payee storage next = $.payees[rotation.newSeal];
        next.exists = true;
        next.paidCount = old.paidCount;
        next.payout = old.payout;
        next.payoutDomain = old.payoutDomain;
        next.activeAt = activeAt;
        next.risk = old.risk;
        next.screenedAt = old.screenedAt;
        next.terms = old.terms;
        emit SealRotationConfirmed(rotation.oldSeal, rotation.newSeal, activeAt);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Orders and budgets
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function openPurchaseOrder(bytes32 poRef, address seal, bytes32 budgetId, uint256 amount, uint64 releaseAfter)
        external
        onlyOwner
    {
        if (poRef == bytes32(0) || seal == address(0)) revert ZeroAddress();
        if (!_s().budgets[budgetId].exists) revert UnknownBudget(budgetId);
        _s().purchaseOrders[poRef] =
            PurchaseOrder({open: true, seal: seal, releaseAfter: releaseAfter, budget: budgetId, remaining: amount});
        emit PurchaseOrderOpened(poRef, seal, budgetId, amount, releaseAfter);
    }

    /// @inheritdoc ISymbolonVault
    function closePurchaseOrder(bytes32 poRef) external onlyOwner {
        if (!_s().purchaseOrders[poRef].open) revert PurchaseOrderNotOpen(poRef);
        _s().purchaseOrders[poRef].open = false;
        emit PurchaseOrderClosed(poRef);
    }

    /// @inheritdoc ISymbolonVault
    function setBudget(bytes32 budgetId, uint256 cap, uint64 periodLength) external onlyOwner {
        if (periodLength == 0) revert InvalidPeriod();
        Budget storage b = _s().budgets[budgetId];
        bool loosening = b.exists && (cap > b.cap || periodLength < b.periodLength);
        if (!_gate(loosening)) return;

        if (!b.exists) b.exists = true;
        if (b.periodLength != periodLength) {
            // restart the period so a new length never inherits an index computed with the old one
            b.periodIndex = uint64(block.timestamp / periodLength);
            b.spent = 0;
        }
        b.cap = cap;
        b.periodLength = periodLength;
        emit BudgetSet(budgetId, cap, periodLength);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Policy and roles
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function setPolicy(Policy calldata newPolicy) external onlyOwner {
        if (!_gate(_isLoosening(_s().policy, newPolicy))) return;
        _s().policy = newPolicy;
        emit PolicySet(newPolicy);
    }

    /// @inheritdoc ISymbolonVault
    function setSteward(address newSteward) external onlyOwner {
        if (newSteward != address(0)) _assertNotPrivileged(newSteward);
        if (!_gate(newSteward != address(0))) return;
        _s().steward = newSteward;
        emit StewardSet(newSteward);
    }

    /// @inheritdoc ISymbolonVault
    function setApprover(address approver, bytes32 budgetId, bool enabled) external onlyOwner {
        if (approver == address(0)) revert ZeroAddress();
        if (enabled && approver == _s().steward) revert StewardCannotHoldRole(approver);
        if (_s().approvers[approver][budgetId] == enabled) return;
        if (!_gate(enabled)) return;
        _s().approvers[approver][budgetId] = enabled;
        if (enabled) ++_s().approverBudgetCount[approver];
        else --_s().approverBudgetCount[approver];
        emit ApproverSet(approver, budgetId, enabled);
    }

    /// @inheritdoc ISymbolonVault
    function setRequester(address requester, bool enabled) external onlyOwner {
        if (requester == address(0)) revert ZeroAddress();
        if (enabled && requester == _s().steward) revert StewardCannotHoldRole(requester);
        if (!_gate(enabled)) return;
        _s().isRequester[requester] = enabled;
        emit RequesterSet(requester, enabled);
    }

    /// @inheritdoc ISymbolonVault
    function setScreener(address newScreener) external onlyOwner {
        if (newScreener != address(0) && newScreener == _s().steward) revert StewardCannotHoldRole(newScreener);
        if (!_gate(newScreener != address(0))) return;
        _s().screener = newScreener;
        emit ScreenerSet(newScreener);
    }

    /// @inheritdoc ISymbolonVault
    function setSupportedToken(address token, bool supported) external onlyOwner {
        // USYC is a permissioned fund share: it is held as a reserve, never used to pay
        if (supported && token == address(_usyc)) revert UsycNotPayable();
        if (supported) _checkDecimals(token);
        if (!_gate(supported)) return;
        _s().isSupportedToken[token] = supported;
        emit SupportedTokenSet(token, supported);
    }

    /// @inheritdoc ISymbolonVault
    function cancelQueuedChange(bytes32 id) external onlyOwner {
        if (_s().queuedChanges[id] == 0) revert UnknownChange(id);
        delete _s().queuedChanges[id];
        emit ChangeCancelled(id);
    }

    /// @inheritdoc ISymbolonVault
    function pause() external onlyOwner {
        _s().paused = true;
        emit Paused(msg.sender);
    }

    /// @inheritdoc ISymbolonVault
    function unpause() external onlyOwner {
        _s().paused = false;
        emit Unpaused(msg.sender);
    }

    /// @inheritdoc ISymbolonVault
    function withdraw(address token, address to, uint256 amount) external nonReentrant onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit Withdrawn(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Reserve (USYC), for Vaults Circle has allowlisted
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function setReservePolicy(ReservePolicy calldata policy) external onlyOwner {
        if (!_gate(ReserveLogic.checkPolicy(_s(), usycTeller, policy))) return;
        _s().reserve = policy;
        emit ReservePolicySet(policy);
    }

    /// @inheritdoc ISymbolonVault
    function subscribeReserve(uint256 assets, uint256 minShares, bytes32 decisionHash)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (msg.sender != _s().steward && msg.sender != owner()) revert NotTreasurer();
        if (_s().paused) revert VaultPaused();
        shares = ReserveLogic.subscribe(_s(), usycTeller, _usyc, _reserveAsset, assets, minShares);
        emit ReserveSubscribed(msg.sender, assets, shares, decisionHash);
    }

    /// @inheritdoc ISymbolonVault
    function redeemReserve(uint256 shares, uint256 minAssets, bytes32 decisionHash)
        external
        nonReentrant
        returns (uint256 assets)
    {
        // the owner can always return to cash; the steward only while the Vault isn't paused
        if (msg.sender != owner()) {
            if (msg.sender != _s().steward) revert NotTreasurer();
            if (_s().paused) revert VaultPaused();
        }
        assets = ReserveLogic.redeem(usycTeller, _reserveAsset, shares, minAssets);
        emit ReserveRedeemed(msg.sender, shares, assets, decisionHash);
    }

    /// @dev The steward can never be the owner; a pending owner who is the steward can't accept
    function transferOwnership(address newOwner) public override(Ownable2StepUpgradeable) onlyOwner {
        if (newOwner == _s().steward) revert StewardCannotHoldRole(newOwner);
        super.transferOwnership(newOwner);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Upgrades
    // ---------------------------------------------------------------------------------------------------------------

    /// @inheritdoc ISymbolonVault
    function scheduleUpgrade(address newImplementation) external onlyOwner {
        if (newImplementation == address(0)) revert ZeroAddress();
        uint64 readyAt = uint64(block.timestamp) + _s().policy.looseningDelay;
        _s().scheduledUpgrades[newImplementation] = readyAt;
        emit UpgradeScheduled(newImplementation, readyAt);
    }

    /// @inheritdoc ISymbolonVault
    function cancelUpgrade(address newImplementation) external onlyOwner {
        if (_s().scheduledUpgrades[newImplementation] == 0) revert UpgradeNotScheduled(newImplementation);
        delete _s().scheduledUpgrades[newImplementation];
        emit UpgradeCancelled(newImplementation);
    }

    /// @inheritdoc ISymbolonVault
    function setAutoUpdate(bool enabled) external onlyOwner {
        if (!_gate(enabled)) return;
        _s().autoUpdate = enabled;
        emit AutoUpdateSet(enabled);
    }

    /// @inheritdoc ISymbolonVault
    function scheduleRelease(address newImplementation) external {
        VaultStorage storage $ = _s();
        if (!$.autoUpdate) revert AutoUpdateOff();
        if (!releaseRegistry.isPublished(newImplementation)) revert ReleaseNotPublished(newImplementation);
        if ($.scheduledUpgrades[newImplementation] != 0) revert UpgradeAlreadyScheduled(newImplementation);
        uint64 readyAt = uint64(block.timestamp) + $.policy.looseningDelay;
        $.scheduledUpgrades[newImplementation] = readyAt;
        emit UpgradeScheduled(newImplementation, readyAt);
    }

    /// @inheritdoc ISymbolonVault
    function applyRelease(address newImplementation) external {
        VaultStorage storage $ = _s();
        // re-checked at apply time: switching auto-update off or revoking the release stops a pending one
        if (!$.autoUpdate) revert AutoUpdateOff();
        if (!releaseRegistry.isPublished(newImplementation)) revert ReleaseNotPublished(newImplementation);
        $.applyingRelease = true;
        // empty calldata: a non-owner never runs initialization code through the proxy
        upgradeToAndCall(newImplementation, "");
        $.applyingRelease = false;
    }

    /// @notice The owner, or an auto-update release inside `applyRelease`; either way, only an implementation
    /// scheduled at least `looseningDelay` ago
    /// @dev UUPS completes the upgrade after this returns, so the delay is a separate schedule rather than `_gate`
    function _authorizeUpgrade(address newImplementation) internal override {
        VaultStorage storage $ = _s();
        if (msg.sender != owner() && !$.applyingRelease) revert OwnableUnauthorizedAccount(msg.sender);
        uint64 readyAt = $.scheduledUpgrades[newImplementation];
        if (readyAt == 0) revert UpgradeNotScheduled(newImplementation);
        if (block.timestamp < readyAt) revert UpgradeNotReady(newImplementation, readyAt);
        delete $.scheduledUpgrades[newImplementation];
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Resolves and checks the payee for an invoice: verified, cooled off, not retired, paid at the signed
    /// and confirmed address, screened
    function _activePayee(Invoice calldata inv) internal returns (Payee storage p) {
        p = _s().payees[inv.seal];
        if (!p.exists) revert UnknownPayee(inv.seal);
        if (block.timestamp < p.activeAt) revert PayeeNotActive(inv.seal, p.activeAt);
        if (p.retireAt != 0 && block.timestamp >= p.retireAt) revert PayeeRetired(inv.seal);

        _applyClearedPayoutChange(p);
        if (inv.payoutAddress != p.payout || inv.payoutDomain != p.payoutDomain) {
            revert PayoutMismatch(p.payout, p.payoutDomain);
        }

        if (p.risk == Risk.Blocked) revert PayeeBlocked(inv.seal);
        uint64 maxAge = _s().policy.screeningMaxAge;
        if (maxAge != 0 && (p.screenedAt == 0 || block.timestamp > uint256(p.screenedAt) + maxAge)) {
            revert ScreeningStale(inv.seal, p.screenedAt);
        }
    }

    /// @notice Promotes a pending payout change to current once its cooldown has passed
    function _applyClearedPayoutChange(Payee storage p) internal {
        if (p.pendingActiveAt == 0 || block.timestamp < p.pendingActiveAt) return;
        p.payout = p.pendingPayout;
        p.payoutDomain = p.pendingDomain;
        p.pendingPayout = address(0);
        p.pendingDomain = 0;
        p.pendingActiveAt = 0;
    }

    /// @notice Checks the invoice against its purchase order and draws it down; returns the PO's budget
    /// @dev Called when the payee requires a PO, or when the invoice cites a PO this Vault issued. A cited PO the
    /// Vault never issued is left to the Steward to flag rather than blocking payment.
    function _matchPurchaseOrder(Invoice calldata inv, uint256 credit) internal returns (bytes32) {
        if (inv.poRef == bytes32(0)) revert PurchaseOrderRequired();
        PurchaseOrder storage po = _s().purchaseOrders[inv.poRef];
        if (!po.open) revert PurchaseOrderNotOpen(inv.poRef);
        if (po.seal != inv.seal) revert PurchaseOrderWrongVendor(inv.poRef);
        if (block.timestamp < po.releaseAfter) revert PurchaseOrderNotReleased(inv.poRef, po.releaseAfter);
        if (credit > po.remaining) revert PurchaseOrderExceeded(inv.poRef, po.remaining);
        po.remaining -= credit;
        return po.budget;
    }

    /// @notice Enforces the per-transaction cap, the payee's 30-day cap and the budget, and records the spend
    function _checkLimits(Payee storage p, bytes32 budgetId, uint256 outflow) internal {
        if (outflow > _s().policy.perTxCap) revert PerTxCapExceeded(_s().policy.perTxCap, outflow);

        uint64 period = uint64(block.timestamp / PAYEE_PERIOD);
        if (p.spendPeriod != period) {
            p.spendPeriod = period;
            p.spentInPeriod = 0;
        }
        if (p.spentInPeriod + outflow > p.terms.monthlyCap) {
            revert PayeeCapExceeded(p.terms.monthlyCap, p.spentInPeriod, outflow);
        }
        p.spentInPeriod += outflow;

        Budget storage b = _s().budgets[budgetId];
        if (!b.exists) revert UnknownBudget(budgetId);
        uint64 index = uint64(block.timestamp / b.periodLength);
        if (b.periodIndex != index) {
            b.periodIndex = index;
            b.spent = 0;
        }
        if (b.spent + outflow > b.cap) revert BudgetExceeded(budgetId, b.cap, b.spent, outflow);
        b.spent += outflow;
    }

    /// @notice Works out which sign-off the payment needs and checks it was given
    function _checkApprovals(
        Payee storage p,
        bytes32 budgetId,
        bytes32 fp,
        uint256 credit,
        uint256 outflow,
        SignedApproval[] calldata approvals
    ) internal view {
        ApprovalLevel required = _requiredLevel(p, outflow);
        if (required == ApprovalLevel.None) return;

        ApprovalLevel given = _levelOf(msg.sender, budgetId);
        for (uint256 i; i < approvals.length && given < required; ++i) {
            SignedApproval calldata a = approvals[i];
            if (block.timestamp > a.deadline) revert ApprovalExpired(a.signer);
            ApprovalLevel level = _levelOf(a.signer, budgetId);
            if (level == ApprovalLevel.None) revert InvalidApproval(a.signer);
            bytes32 digest =
                _digest(Approval({vault: address(this), fingerprint: fp, credit: credit, deadline: a.deadline}).hash());
            if (!SealSignature.isValid(a.signer, digest, a.signature)) revert InvalidApproval(a.signer);
            if (level > given) given = level;
        }
        if (given < required) revert ApprovalRequired(required);
    }

    /// @notice The highest sign-off required by amount, vendor history and screening risk
    function _requiredLevel(Payee storage p, uint256 outflow) internal view returns (ApprovalLevel level) {
        if (outflow > _s().policy.ownerThreshold || p.risk == Risk.High) return ApprovalLevel.Owner;
        if (outflow > _s().policy.autoPayLimit || p.paidCount < _s().policy.newVendorMinPaid || p.risk == Risk.Medium) {
            return ApprovalLevel.Approver;
        }
        return ApprovalLevel.None;
    }

    /// @notice The sign-off an account can give for a budget. The steward can give none.
    function _levelOf(address account, bytes32 budgetId) internal view returns (ApprovalLevel) {
        if (account == address(0) || account == _s().steward) return ApprovalLevel.None;
        if (account == owner()) return ApprovalLevel.Owner;
        if (_s().approvers[account][budgetId] || _s().approvers[account][OPERATING_BUDGET]) {
            return ApprovalLevel.Approver;
        }
        return ApprovalLevel.None;
    }

    /// @notice Queues a loosening change or lets a ready one through. Tightening changes always pass immediately.
    /// @dev A queued change is identified by its exact calldata: the owner repeats the same call after the delay.
    /// @return proceed True if the caller should apply the change now
    function _gate(bool loosening) internal returns (bool proceed) {
        if (!loosening) return true;
        bytes32 id = keccak256(msg.data);
        uint64 eta = _s().queuedChanges[id];
        if (eta == 0) {
            eta = uint64(block.timestamp) + _s().policy.looseningDelay;
            if (eta == block.timestamp) return true;
            _s().queuedChanges[id] = eta;
            emit ChangeQueued(id, msg.sig, eta);
            return false;
        }
        if (block.timestamp < eta) revert ChangeNotReady(id, eta);
        delete _s().queuedChanges[id];
        return true;
    }

    /// @notice True if any field of `next` is looser than `current`
    function _isLoosening(Policy storage current, Policy calldata next) internal view returns (bool) {
        return next.perTxCap > current.perTxCap || next.autoPayLimit > current.autoPayLimit
            || next.ownerThreshold > current.ownerThreshold || next.newVendorMinPaid < current.newVendorMinPaid
            || _screeningLooser(current.screeningMaxAge, next.screeningMaxAge)
            || next.newPayeeDelay < current.newPayeeDelay || next.changeCooldown < current.changeCooldown
            || next.looseningDelay < current.looseningDelay || next.maxBridgeFee > current.maxBridgeFee;
    }

    /// @notice A screening max age of 0 means "not required", which is the loosest setting
    function _screeningLooser(uint64 current, uint64 next) internal pure returns (bool) {
        if (next == 0) return current != 0;
        return current != 0 && next > current;
    }

    /// @dev Approvers of any budget may initiate payments; `_levelOf` only counts them for their own budgets
    function _isAnyApprover(address account) internal view returns (bool) {
        return _s().approverBudgetCount[account] != 0;
    }

    function _assertNotPrivileged(address account) internal view {
        if (
            account == owner() || account == pendingOwner() || _s().isRequester[account] || account == _s().screener
                || _isAnyApprover(account)
        ) {
            revert StewardCannotHoldRole(account);
        }
    }

    function _checkDecimals(address token) internal view {
        uint8 decimals = IERC20Metadata(token).decimals();
        if (decimals != _s().accountingDecimals) revert TokenDecimalsMismatch(token, decimals);
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    function _s() private pure returns (VaultStorage storage) {
        return VaultStorageLib.load();
    }
}
