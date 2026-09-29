// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Circle's Entitlements, reduced to a per-address allowlist
contract MockEntitlements {
    mapping(address user => bool) public allowed;

    function setAllowed(address user, bool ok) external {
        allowed[user] = ok;
    }

    function canCall(address user, address, bytes4) external view returns (bool) {
        return allowed[user];
    }
}

/// @notice USYC: only the Teller mints and burns
contract MockUsyc is ERC20 {
    address public immutable teller;

    constructor(address teller_) ERC20("US Yield Coin", "USYC") {
        teller = teller_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _burn(from, amount);
    }
}

/// @notice Behaves like Circle's USYC Teller as read from its verified source on Arc testnet: pulls the asset from
/// the caller into a treasury, mints shares at an 18-decimal price net of a fee, redeems from a treasury, checks
/// entitlements and a daily limit. `lieBy` makes it report more than it actually moved, to test min-out checks.
contract MockUsycTeller {
    using SafeERC20 for IERC20;

    uint256 private constant PRICE_SCALE = 1e18;
    uint256 private constant FEE_SCALE = 1e18;

    IERC20 public immutable assetToken;
    MockUsyc public immutable usycToken;
    MockEntitlements public immutable entitlements;
    address public immutable treasuryAccount = address(0x7EA5);

    uint256 public price = 1.1386e18;
    uint256 public feeRate;
    uint256 public dailyLimit = type(uint256).max;
    uint256 public lieBy;
    uint256 public shortBy;

    error NotPermissioned();
    error LimitExceeded();

    constructor(IERC20 asset_) {
        assetToken = asset_;
        usycToken = new MockUsyc(address(this));
        entitlements = new MockEntitlements();
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function share() external view returns (address) {
        return address(usycToken);
    }

    function authority() external view returns (address) {
        return address(entitlements);
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setFeeRate(uint256 r) external {
        feeRate = r;
    }

    function setDailyLimit(uint256 l) external {
        dailyLimit = l;
    }

    function setLie(uint256 lie, uint256 shortfall) external {
        lieBy = lie;
        shortBy = shortfall;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (!entitlements.allowed(msg.sender) || !entitlements.allowed(receiver)) revert NotPermissioned();
        if (assets > dailyLimit) revert LimitExceeded();
        uint256 fee = assets * feeRate / FEE_SCALE;
        shares = (assets - fee) * PRICE_SCALE / price - shortBy;
        assetToken.safeTransferFrom(msg.sender, treasuryAccount, assets);
        usycToken.mint(receiver, shares);
        return shares + lieBy;
    }

    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets) {
        require(msg.sender == account, "allowance not modelled");
        if (!entitlements.allowed(msg.sender) || !entitlements.allowed(receiver)) revert NotPermissioned();
        uint256 gross = shares * price / PRICE_SCALE;
        assets = gross - gross * feeRate / FEE_SCALE - shortBy;
        usycToken.burn(account, shares);
        assetToken.safeTransferFrom(treasuryAccount, receiver, assets);
        return assets + lieBy;
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares * price / PRICE_SCALE;
    }
}
