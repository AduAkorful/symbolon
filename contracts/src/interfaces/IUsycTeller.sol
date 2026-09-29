// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice The parts of Circle's USYC Teller the Vault uses. Source read from the verified implementation on Arc
/// testnet (`Teller`, 0x238dc235e6996e93ed7fbe89e69113bfcfe1adf6 behind 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A).
interface IUsycTeller {
    /// @notice The subscription asset (USDC)
    function asset() external view returns (address);

    /// @notice The USYC token
    function share() external view returns (address);

    /// @notice Circle's Entitlements contract, which decides who may subscribe, redeem and hold USYC
    function authority() external view returns (address);

    /// @notice Pulls `assets` from the caller and mints USYC to `receiver`
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Burns `shares` from `account` and pays the proceeds to `receiver`
    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets);

    /// @notice Value of `shares` in the asset at the latest oracle price
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
}

/// @notice Circle's USYC Entitlements (a RolesAuthority)
interface IUsycEntitlements {
    function canCall(address user, address target, bytes4 functionSig) external view returns (bool);
}
