// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice A configurable ERC-4626-shaped lending vault for the Vault's lending-reserve tests (plan 05zk). It models what
/// the real testnet vault showed: 18-decimal shares over a 6-decimal asset, floor rounding on both legs (one unit lost per
/// round trip), no `max*` functions, an exit that can be blocked, and a gate that can lock a holder out. It can also lie
/// about what it returned, skim shares on entry, and call back into a target during a move.
contract MockLendingVenue {
    error ExitBlocked();
    error GateClosed(address holder);
    error CallbackFailed(bytes reason);

    uint256 private constant SHARE_SCALE = 1e12; // 18-decimal shares over a 6-decimal asset

    IERC20 public immutable asset;

    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    /// @notice Assets per whole share, 1e18 = one asset per share
    uint256 public priceE18 = 1e18;
    /// @notice Share of the honest shares withheld on entry, in basis points (a venue minting junk)
    uint256 public skimBps;
    bool public exitReverts;
    mapping(address => bool) public gated;
    uint256 public claimExtra;
    uint256 public payShort;
    address public callbackTarget;
    bytes public callbackData;

    constructor(IERC20 asset_) {
        asset = asset_;
    }

    /// @notice Shares have 18 decimals, as the live vault's do
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function setPrice(uint256 priceE18_) external {
        priceE18 = priceE18_;
    }

    function setSkimBps(uint256 bps) external {
        skimBps = bps;
    }

    function setExitReverts(bool value) external {
        exitReverts = value;
    }

    function setGated(address holder, bool value) external {
        gated[holder] = value;
    }

    /// @notice Makes return values claim `extra` more than was delivered and delivery `short` less than honest
    function setLie(uint256 extra, uint256 short) external {
        claimExtra = extra;
        payShort = short;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return assets * SHARE_SCALE * 1e18 / priceE18;
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return shares * priceE18 / 1e18 / SHARE_SCALE;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return previewRedeem(shares);
    }

    function totalAssets() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        asset.transferFrom(msg.sender, address(this), assets);
        uint256 honest = previewDeposit(assets) * (10_000 - skimBps) / 10_000;
        uint256 minted = honest > payShort ? honest - payShort : 0;
        balanceOf[receiver] += minted;
        totalSupply += minted;
        _callback();
        return honest + claimExtra;
    }

    function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256) {
        if (exitReverts) revert ExitBlocked();
        if (gated[onBehalf]) revert GateClosed(onBehalf);
        require(msg.sender == onBehalf, "allowance not modelled");
        balanceOf[onBehalf] -= shares;
        totalSupply -= shares;
        uint256 honest = previewRedeem(shares);
        uint256 paid = honest > payShort ? honest - payShort : 0;
        asset.transfer(receiver, paid);
        _callback();
        return honest + claimExtra;
    }

    function _callback() private {
        if (callbackTarget == address(0)) return;
        (bool ok, bytes memory reason) = callbackTarget.call(callbackData);
        if (!ok) {
            // bubble the target's own revert so a test can assert on it
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }
}
