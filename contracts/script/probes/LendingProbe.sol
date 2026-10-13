// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Interfaces
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @title LendingProbe
/// @notice THROWAWAY, never part of a release (plan 05zk, step R4). It answers one question on the real testnet vault
/// before any Vault code is written: can a *contract* deposit into and redeem from an ERC-4626 lending vault with
/// itself as receiver, exactly as the Vault would? Deployed with `forge create` (a Forge script cannot simulate Arc USDC).
contract LendingProbe {
    using SafeERC20 for IERC20;

    error NotOwner();

    event Deposited(address indexed venue, uint256 assets, uint256 shares);
    event Redeemed(address indexed venue, uint256 shares, uint256 assets);

    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @notice Deposits this contract's whole balance of the venue's asset, with this contract as receiver
    function depositAll(IERC4626 venue) external onlyOwner returns (uint256 shares) {
        IERC20 asset = IERC20(venue.asset());
        uint256 assets = asset.balanceOf(address(this));
        asset.forceApprove(address(venue), assets);
        shares = venue.deposit(assets, address(this));
        asset.forceApprove(address(venue), 0);
        emit Deposited(address(venue), assets, shares);
    }

    /// @notice Redeems all shares this contract holds back to itself
    function redeemAll(IERC4626 venue) external onlyOwner returns (uint256 assets) {
        uint256 shares = venue.balanceOf(address(this));
        assets = venue.redeem(shares, address(this), address(this));
        emit Redeemed(address(venue), shares, assets);
    }

    /// @notice Deposits everything and redeems it back in one call: with state overrides in an `eth_call` this proves the
    /// whole contract-as-depositor path against the real vault without sending a transaction
    function roundTrip(IERC4626 venue) external onlyOwner returns (uint256 assetsIn, uint256 shares, uint256 assetsBack) {
        IERC20 asset = IERC20(venue.asset());
        assetsIn = asset.balanceOf(address(this));
        asset.forceApprove(address(venue), assetsIn);
        shares = venue.deposit(assetsIn, address(this));
        asset.forceApprove(address(venue), 0);
        assetsBack = venue.redeem(shares, address(this), address(this));
    }

    /// @notice Sends any token held here to `to`, so the probe never keeps funds
    function sweep(IERC20 token, address to) external onlyOwner {
        token.safeTransfer(to, token.balanceOf(address(this)));
    }
}
