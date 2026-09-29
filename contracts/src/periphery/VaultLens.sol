// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {VaultStorageLib} from "../libraries/VaultStorage.sol";

// Interfaces
import {IExtsload} from "../interfaces/IExtsload.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISymbolonVault} from "../interfaces/ISymbolonVault.sol";
import {IUsycTeller, IUsycEntitlements} from "../interfaces/IUsycTeller.sol";

/// @title VaultLens
/// @notice Stateless reader for any SymbolonVault. Decodes the Vault's ERC-7201 storage through `extsload`, so the
/// Vault itself carries no getters.
/// @dev Offsets mirror `VaultStorage` exactly (checked by `forge inspect` on `test/harness/VaultStorageLayout.sol` and by
/// round-trip tests). `VaultStorage` is append-only, so these offsets stay valid across Vault upgrades.
contract VaultLens {
    uint256 private constant BASE = uint256(VaultStorageLib.SLOT);

    // VaultStorage field offsets from BASE
    uint256 private constant PAYEES = 0;
    uint256 private constant BUDGETS = 1;
    uint256 private constant PURCHASE_ORDERS = 2;
    uint256 private constant DELIVERY_CONFIRMED = 3;
    uint256 private constant APPROVERS = 4;
    uint256 private constant APPROVER_BUDGET_COUNT = 5;
    uint256 private constant IS_REQUESTER = 6;
    uint256 private constant IS_SUPPORTED_TOKEN = 7;
    uint256 private constant QUEUED_CHANGES = 8;
    uint256 private constant SCHEDULED_UPGRADES = 9;
    uint256 private constant POLICY = 10;
    uint256 private constant STEWARD = 16;
    // screener (bytes 0-19), paused (20), accountingDecimals (21), autoUpdate (22), applyingRelease (23)
    uint256 private constant FLAGS = 17;
    // release 2: enabled (byte 0), maxReserveBps (bytes 1-2); minOperating in the next slot
    uint256 private constant RESERVE = 18;

    uint256 private constant PAYEE_SLOTS = 8;
    uint256 private constant BUDGET_SLOTS = 3;
    uint256 private constant PURCHASE_ORDER_SLOTS = 3;
    uint256 private constant POLICY_SLOTS = 6;
    bytes32 private constant OPERATING_BUDGET = bytes32(0);

    /// @notice A Vault's USYC reserve as it stands, with Circle's current eligibility for it
    /// @param usycTeller Zero when the Vault's implementation has no USYC support (release 1, or a chain without USYC)
    /// @param entitled Whether Circle's Entitlements let this Vault subscribe right now
    /// @param cash The Vault's balance of the Teller's asset (USDC)
    /// @param shares USYC held by the Vault
    /// @param reserveValue `shares` valued at the Teller's latest oracle price, in the asset
    struct ReserveStatus {
        address usycTeller;
        address usyc;
        bool entitled;
        uint256 cash;
        uint256 shares;
        uint256 reserveValue;
        ISymbolonVault.ReservePolicy policy;
    }

    /// @notice Everything the app needs for a Vault's header in one call
    struct VaultState {
        address owner;
        address pendingOwner;
        address steward;
        address screener;
        bool paused;
        uint8 accountingDecimals;
        bool autoUpdate;
        ISymbolonVault.Policy policy;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Whole-Vault
    // ---------------------------------------------------------------------------------------------------------------

    function getVaultState(address vault) external view returns (VaultState memory state) {
        state.owner = IOwnable(vault).owner();
        state.pendingOwner = IOwnable(vault).pendingOwner();
        state.steward = steward(vault);
        (state.screener, state.paused, state.accountingDecimals, state.autoUpdate) = _flags(vault);
        state.policy = getPolicy(vault);
    }

    function getPolicy(address vault) public view returns (ISymbolonVault.Policy memory policy) {
        bytes32[] memory w = IExtsload(vault).extsload(bytes32(BASE + POLICY), POLICY_SLOTS);
        policy.perTxCap = uint256(w[0]);
        policy.autoPayLimit = uint256(w[1]);
        policy.ownerThreshold = uint256(w[2]);
        policy.newVendorMinPaid = uint32(_bits(w[3], 0, 4));
        policy.screeningMaxAge = uint64(_bits(w[3], 4, 8));
        policy.newPayeeDelay = uint64(_bits(w[3], 12, 8));
        policy.changeCooldown = uint64(_bits(w[3], 20, 8));
        policy.looseningDelay = uint64(_bits(w[4], 0, 8));
        policy.maxBridgeFee = uint256(w[5]);
    }

    function steward(address vault) public view returns (address) {
        return address(uint160(uint256(IExtsload(vault).extsload(bytes32(BASE + STEWARD)))));
    }

    function screener(address vault) external view returns (address s) {
        (s,,,) = _flags(vault);
    }

    function paused(address vault) external view returns (bool p) {
        (, p,,) = _flags(vault);
    }

    function accountingDecimals(address vault) external view returns (uint8 d) {
        (,, d,) = _flags(vault);
    }

    function autoUpdate(address vault) external view returns (bool a) {
        (,,, a) = _flags(vault);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Payees
    // ---------------------------------------------------------------------------------------------------------------

    function getPayee(address vault, address seal) public view returns (ISymbolonVault.Payee memory p) {
        bytes32 start = _mapSlot(abi.encode(seal, BASE + PAYEES));
        bytes32[] memory w = IExtsload(vault).extsload(start, PAYEE_SLOTS);
        p.exists = _bits(w[0], 0, 1) != 0;
        p.paidCount = uint32(_bits(w[0], 1, 4));
        p.payout = address(uint160(_bits(w[0], 5, 20)));
        p.payoutDomain = uint32(_bits(w[0], 25, 4));
        p.activeAt = uint64(_bits(w[1], 0, 8));
        p.retireAt = uint64(_bits(w[1], 8, 8));
        p.lastChangeNonce = uint64(_bits(w[1], 16, 8));
        p.pendingPayout = address(uint160(_bits(w[2], 0, 20)));
        p.pendingDomain = uint32(_bits(w[2], 20, 4));
        p.pendingActiveAt = uint64(_bits(w[2], 24, 8));
        p.risk = ISymbolonVault.Risk(uint8(_bits(w[3], 0, 1)));
        p.screenedAt = uint64(_bits(w[3], 1, 8));
        p.spendPeriod = uint64(_bits(w[3], 9, 8));
        p.spentInPeriod = uint256(w[4]);
        p.terms.budget = w[5];
        p.terms.requirePo = _bits(w[6], 0, 1) != 0;
        p.terms.requireDelivery = _bits(w[6], 1, 1) != 0;
        p.terms.monthlyCap = uint256(w[7]);
    }

    /// @notice The payout a payee can be paid at right now, accounting for any change whose cooldown has passed
    function currentPayout(address vault, address seal) external view returns (address payout, uint32 payoutDomain) {
        ISymbolonVault.Payee memory p = getPayee(vault, seal);
        if (p.pendingActiveAt != 0 && block.timestamp >= p.pendingActiveAt) return (p.pendingPayout, p.pendingDomain);
        return (p.payout, p.payoutDomain);
    }

    /// @notice The sign-off the Vault would require to pay `outflow` to `seal` right now
    function requiredApproval(address vault, address seal, uint256 outflow)
        external
        view
        returns (ISymbolonVault.ApprovalLevel)
    {
        ISymbolonVault.Payee memory p = getPayee(vault, seal);
        ISymbolonVault.Policy memory policy = getPolicy(vault);
        if (outflow > policy.ownerThreshold || p.risk == ISymbolonVault.Risk.High) {
            return ISymbolonVault.ApprovalLevel.Owner;
        }
        if (
            outflow > policy.autoPayLimit || p.paidCount < policy.newVendorMinPaid
                || p.risk == ISymbolonVault.Risk.Medium
        ) return ISymbolonVault.ApprovalLevel.Approver;
        return ISymbolonVault.ApprovalLevel.None;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Budgets, orders, delivery
    // ---------------------------------------------------------------------------------------------------------------

    function getBudget(address vault, bytes32 id) external view returns (ISymbolonVault.Budget memory b) {
        bytes32[] memory w = IExtsload(vault).extsload(_mapSlot(abi.encode(id, BASE + BUDGETS)), BUDGET_SLOTS);
        b.exists = _bits(w[0], 0, 1) != 0;
        b.periodLength = uint64(_bits(w[0], 1, 8));
        b.periodIndex = uint64(_bits(w[0], 9, 8));
        b.cap = uint256(w[1]);
        b.spent = uint256(w[2]);
    }

    function getPurchaseOrder(address vault, bytes32 poRef)
        external
        view
        returns (ISymbolonVault.PurchaseOrder memory po)
    {
        bytes32[] memory w =
            IExtsload(vault).extsload(_mapSlot(abi.encode(poRef, BASE + PURCHASE_ORDERS)), PURCHASE_ORDER_SLOTS);
        po.open = _bits(w[0], 0, 1) != 0;
        po.seal = address(uint160(_bits(w[0], 1, 20)));
        po.releaseAfter = uint64(_bits(w[0], 21, 8));
        po.budget = w[1];
        po.remaining = uint256(w[2]);
    }

    function deliveryConfirmed(address vault, bytes32 fp) external view returns (bool) {
        return _readBool(vault, _mapSlot(abi.encode(fp, BASE + DELIVERY_CONFIRMED)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Roles, tokens, queued changes, upgrades
    // ---------------------------------------------------------------------------------------------------------------

    /// @notice Whether `account` can approve payments charged to `budgetId` (operating-budget approvers approve all)
    function isApprover(address vault, address account, bytes32 budgetId) external view returns (bool) {
        bytes32 inner = _mapSlot(abi.encode(account, BASE + APPROVERS));
        return _readBool(vault, _mapSlot(abi.encode(budgetId, inner)))
            || _readBool(vault, _mapSlot(abi.encode(OPERATING_BUDGET, inner)));
    }

    function approverBudgetCount(address vault, address account) external view returns (uint256) {
        return uint256(IExtsload(vault).extsload(_mapSlot(abi.encode(account, BASE + APPROVER_BUDGET_COUNT))));
    }

    function isRequester(address vault, address account) external view returns (bool) {
        return _readBool(vault, _mapSlot(abi.encode(account, BASE + IS_REQUESTER)));
    }

    function isSupportedToken(address vault, address token) external view returns (bool) {
        return _readBool(vault, _mapSlot(abi.encode(token, BASE + IS_SUPPORTED_TOKEN)));
    }

    /// @notice When a queued loosening change becomes applicable (0 if not queued)
    function queuedChangeEta(address vault, bytes32 id) external view returns (uint64) {
        return uint64(uint256(IExtsload(vault).extsload(_mapSlot(abi.encode(id, BASE + QUEUED_CHANGES)))));
    }

    /// @notice When a scheduled upgrade becomes allowed (0 if not scheduled)
    function scheduledUpgrade(address vault, address implementation) external view returns (uint64) {
        return
            uint64(uint256(IExtsload(vault).extsload(_mapSlot(abi.encode(implementation, BASE + SCHEDULED_UPGRADES)))));
    }

    /// @notice The id a loosening call is queued under: the hash of its exact calldata
    function changeId(bytes calldata callData) external pure returns (bytes32) {
        return keccak256(callData);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------------------------

    // ---------------------------------------------------------------------------------------------------------------
    // Reserve (USYC)
    // ---------------------------------------------------------------------------------------------------------------

    function getReservePolicy(address vault) public view returns (ISymbolonVault.ReservePolicy memory policy) {
        bytes32[] memory w = IExtsload(vault).extsload(bytes32(BASE + RESERVE), 2);
        policy.enabled = _bits(w[0], 0, 1) != 0;
        policy.maxReserveBps = uint16(_bits(w[0], 1, 2));
        policy.minOperating = uint256(w[1]);
    }

    function reserveStatus(address vault) external view returns (ReserveStatus memory status) {
        status.policy = getReservePolicy(vault);
        // release-1 Vaults have no `usycTeller` getter; they simply have no reserve
        try IReserveVault(vault).usycTeller() returns (address teller) {
            status.usycTeller = teller;
        } catch {
            return status;
        }
        if (status.usycTeller == address(0)) return status;

        IUsycTeller teller = IUsycTeller(status.usycTeller);
        status.usyc = teller.share();
        status.entitled =
            IUsycEntitlements(teller.authority()).canCall(vault, address(teller), IUsycTeller.deposit.selector);
        status.cash = IERC20(teller.asset()).balanceOf(vault);
        status.shares = IERC20(status.usyc).balanceOf(vault);
        status.reserveValue = teller.convertToAssets(status.shares);
    }

    function _flags(address vault)
        internal
        view
        returns (address screener_, bool paused_, uint8 decimals_, bool autoUpdate_)
    {
        bytes32 w = IExtsload(vault).extsload(bytes32(BASE + FLAGS));
        screener_ = address(uint160(_bits(w, 0, 20)));
        paused_ = _bits(w, 20, 1) != 0;
        decimals_ = uint8(_bits(w, 21, 1));
        autoUpdate_ = _bits(w, 22, 1) != 0;
    }

    function _readBool(address vault, bytes32 slot) internal view returns (bool) {
        return uint256(IExtsload(vault).extsload(slot)) & 0xff != 0;
    }

    /// @notice Solidity mapping slot: keccak256(abi.encode(key, mappingSlot))
    function _mapSlot(bytes memory keyAndSlot) internal pure returns (bytes32) {
        return keccak256(keyAndSlot);
    }

    /// @notice `size` bytes of `word` starting `offset` bytes from its low-order end, as Solidity packs them
    function _bits(bytes32 word, uint256 offset, uint256 size) internal pure returns (uint256) {
        return (uint256(word) >> (offset * 8)) & ((uint256(1) << (size * 8)) - 1);
    }
}

/// @notice The one reserve getter the Vault keeps (an immutable of its implementation, not storage)
interface IReserveVault {
    function usycTeller() external view returns (address);
}

/// @notice OpenZeppelin's owner getters, which the Vault keeps
interface IOwnable {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}
