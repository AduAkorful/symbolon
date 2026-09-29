// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultStorage} from "./VaultStorage.sol";

// Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISymbolonVault} from "../interfaces/ISymbolonVault.sol";
import {IUsycTeller, IUsycEntitlements} from "../interfaces/IUsycTeller.sol";

/// @title ReserveLogic
/// @notice The Vault's USYC reserve moves. An external library (Aave v3's logic-library pattern): it runs inside the
/// Vault via DELEGATECALL, so the Teller and Circle's Entitlements see the Vault as the caller, and the USYC is held
/// by the Vault itself. Access control, pause and the loosening gate stay in the Vault.
library ReserveLogic {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;

    /// @notice Validates a new reserve policy and says whether it loosens the current one
    function checkPolicy(VaultStorage storage $, IUsycTeller teller, ISymbolonVault.ReservePolicy calldata policy)
        external
        view
        returns (bool loosening)
    {
        if (policy.maxReserveBps > BPS) revert ISymbolonVault.InvalidReservePolicy();
        if (policy.enabled && !isEntitled(teller)) revert ISymbolonVault.ReserveNotEntitled();
        ISymbolonVault.ReservePolicy storage current = $.reserve;
        loosening = (policy.enabled && !current.enabled) || policy.maxReserveBps > current.maxReserveBps
            || policy.minOperating < current.minOperating;
    }

    /// @notice Moves `assets` of cash into USYC held by the Vault, then checks the reserve policy still holds
    function subscribe(
        VaultStorage storage $,
        IUsycTeller teller,
        IERC20 usyc,
        IERC20 cashToken,
        uint256 assets,
        uint256 minShares
    ) external returns (uint256 shares) {
        ISymbolonVault.ReservePolicy memory policy = $.reserve;
        if (!policy.enabled) revert ISymbolonVault.ReserveDisabled();

        uint256 sharesBefore = usyc.balanceOf(address(this));
        cashToken.forceApprove(address(teller), assets);
        teller.deposit(assets, address(this));
        cashToken.forceApprove(address(teller), 0);
        // measured from the Vault's own balance, so a wrong return value from the Teller can't pass the check
        shares = usyc.balanceOf(address(this)) - sharesBefore;
        if (shares < minShares) revert ISymbolonVault.ReserveSlippage(minShares, shares);

        uint256 cash = cashToken.balanceOf(address(this));
        if (cash < policy.minOperating) revert ISymbolonVault.OperatingFloor(policy.minOperating, cash);
        uint256 reserveValue = teller.convertToAssets(usyc.balanceOf(address(this)));
        if (reserveValue * BPS > uint256(policy.maxReserveBps) * (cash + reserveValue)) {
            revert ISymbolonVault.ReserveShareExceeded(policy.maxReserveBps, reserveValue, cash + reserveValue);
        }
    }

    /// @notice Redeems `shares` of USYC back to cash in the Vault
    function redeem(IUsycTeller teller, IERC20 cashToken, uint256 shares, uint256 minAssets)
        external
        returns (uint256 assets)
    {
        uint256 cashBefore = cashToken.balanceOf(address(this));
        teller.redeem(shares, address(this), address(this));
        assets = cashToken.balanceOf(address(this)) - cashBefore;
        if (assets < minAssets) revert ISymbolonVault.ReserveSlippage(minAssets, assets);
    }

    /// @notice Whether Circle's Entitlements currently let this Vault subscribe to USYC
    function isEntitled(IUsycTeller teller) public view returns (bool) {
        if (address(teller) == address(0)) return false;
        return
            IUsycEntitlements(teller.authority()).canCall(address(this), address(teller), IUsycTeller.deposit.selector);
    }
}
