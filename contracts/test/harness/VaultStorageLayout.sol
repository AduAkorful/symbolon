// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {VaultStorage} from "../../src/libraries/VaultStorage.sol";

/// @notice Declares VaultStorage as ordinary state so `forge inspect` prints its exact packing for the lens
contract VaultStorageLayout {
    VaultStorage internal s;
}
