// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultStorage} from "./VaultStorage.sol";

// Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ISymbolonVault} from "../interfaces/ISymbolonVault.sol";

/// @title LendingLogic
/// @notice The Vault's lending-reserve moves (plan 05zk). An external library, like `ReserveLogic`: it runs inside the
/// Vault via DELEGATECALL, so the lending vault sees this Vault as the caller and its shares are held by the Vault itself.
/// Access control, pause, reentrancy and the loosening gate stay in the Vault.
/// @dev The venue is a plain ERC-4626 vault the owner approved. Nothing here trusts its return values: shares and assets
/// are measured from the Vault's own balances. Liquidity is never assumed: an exit that reverts leaves the shares held.
// INVARIANT: shares are only ever minted to and redeemed from this Vault (the receiver and owner arguments are `address(this)`)
// INVARIANT: the venue cannot change or be cleared while this Vault holds its shares, so they are never orphaned
// TRUST: the venue (curator, market, collateral) is the owner's choice; the cap bounds what a stuck or loss-making
//        venue can do, and nothing below can make it pay out
library LendingLogic {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// @notice Largest share of (cash + venue value) an owner may allow in the venue (plan 05zk, Q3)
    uint256 internal constant MAX_LENDING_BPS = 5_000;
    /// @notice Most value the shares received may fall short of the assets deposited, in basis points of the deposit
    /// (never less than one unit: a floor-rounding venue loses one unit per leg)
    uint256 internal constant ENTRY_TOLERANCE_BPS = 10;

    /// @notice Validates a new lending policy and says whether it loosens the current one
    function checkPolicy(VaultStorage storage $, ISymbolonVault.LendingPolicy calldata policy)
        external
        view
        returns (bool loosening)
    {
        if (policy.maxLendingBps > MAX_LENDING_BPS) revert ISymbolonVault.InvalidLendingPolicy();
        ISymbolonVault.LendingPolicy storage current = $.lending;

        bool venueChanged = policy.venue != current.venue;
        // shares are never orphaned: the venue stays put (and cannot be cleared) while the Vault holds any
        if (venueChanged && current.venue != address(0) && IERC20(current.venue).balanceOf(address(this)) != 0) {
            revert ISymbolonVault.LendingVaultInUse();
        }

        if (policy.venue == address(0)) {
            if (policy.enabled) revert ISymbolonVault.InvalidLendingPolicy();
        } else if (venueChanged) {
            // a new venue must report an asset the Vault pays in; the Vault, the ledger and tokens report none
            if (!$.isSupportedToken[_assetOf(policy.venue)]) revert ISymbolonVault.InvalidLendingPolicy();
        }

        loosening = (policy.enabled && !current.enabled) || policy.maxLendingBps > current.maxLendingBps
            || (venueChanged && policy.venue != address(0));
    }

    /// @notice Stores the policy and, when the venue changed, the asset it reported
    function store(VaultStorage storage $, ISymbolonVault.LendingPolicy calldata policy) external {
        bool venueChanged = policy.venue != $.lending.venue;
        $.lending = policy;
        if (venueChanged) $.lendingAsset = policy.venue == address(0) ? address(0) : _assetOf(policy.venue);
    }

    /// @notice Moves `assets` of cash into the venue, with the Vault as receiver, then checks the policy still holds
    function deposit(VaultStorage storage $, uint256 assets, uint256 minShares) external returns (uint256 shares) {
        ISymbolonVault.LendingPolicy memory policy = $.lending;
        if (!policy.enabled) revert ISymbolonVault.LendingDisabled();
        IERC4626 venue = IERC4626(policy.venue);
        IERC20 cashToken = IERC20($.lendingAsset);

        uint256 sharesBefore = IERC20(address(venue)).balanceOf(address(this));
        cashToken.forceApprove(address(venue), assets);
        venue.deposit(assets, address(this));
        cashToken.forceApprove(address(venue), 0);
        // measured from the Vault's own balance, so a wrong return value from the venue can't pass the check
        shares = IERC20(address(venue)).balanceOf(address(this)) - sharesBefore;
        if (shares < minShares) revert ISymbolonVault.LendingSlippage(minShares, shares);

        // the shares must be worth about what was paid for them, so a venue minting junk fails whatever `minShares` was
        uint256 tolerance = assets * ENTRY_TOLERANCE_BPS / BPS;
        if (tolerance == 0) tolerance = 1;
        uint256 received = venue.convertToAssets(shares);
        if (received + tolerance < assets) revert ISymbolonVault.LendingSlippage(assets - tolerance, received);

        // the one operating floor is the reserve policy's, shared with USYC
        uint256 cash = cashToken.balanceOf(address(this));
        uint256 floor = $.reserve.minOperating;
        if (cash < floor) revert ISymbolonVault.OperatingFloor(floor, cash);

        uint256 lendingValue = venue.convertToAssets(IERC20(address(venue)).balanceOf(address(this)));
        if (lendingValue * BPS > uint256(policy.maxLendingBps) * (cash + lendingValue)) {
            revert ISymbolonVault.LendingShareExceeded(policy.maxLendingBps, lendingValue, cash + lendingValue);
        }
    }

    /// @notice Redeems `shares` back to cash in the Vault; works with lending disabled
    function redeem(VaultStorage storage $, uint256 shares, uint256 minAssets) external returns (uint256 assets) {
        address venue = $.lending.venue;
        if (venue == address(0)) revert ISymbolonVault.LendingDisabled();
        IERC20 cashToken = IERC20($.lendingAsset);

        uint256 cashBefore = cashToken.balanceOf(address(this));
        IERC4626(venue).redeem(shares, address(this), address(this));
        assets = cashToken.balanceOf(address(this)) - cashBefore;
        if (assets < minAssets) revert ISymbolonVault.LendingSlippage(minAssets, assets);
    }

    /// @dev The asset a venue reports, or a revert: an address that isn't an ERC-4626 vault is refused, never guessed at
    function _assetOf(address venue) private view returns (address asset) {
        (bool ok, bytes memory data) = venue.staticcall(abi.encodeCall(IERC4626.asset, ()));
        if (!ok || data.length != 32) revert ISymbolonVault.InvalidLendingPolicy();
        asset = abi.decode(data, (address));
    }
}
