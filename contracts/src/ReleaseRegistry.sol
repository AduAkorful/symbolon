// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Interfaces
import {IReleaseRegistry} from "./interfaces/IReleaseRegistry.sol";

// Contracts
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ReleaseRegistry
/// @notice Symbolon's published Vault implementations. Publishing gives Symbolon no power over a Vault unless that
/// Vault's owner turned on auto-update; even then each release waits out the Vault's own delay.
/// @dev The owner should be a multisig: it is the key that auto-updating Vaults trust.
contract ReleaseRegistry is IReleaseRegistry, Ownable2Step {
    mapping(address implementation => Release) internal _releases;
    address internal _latest;
    uint64 internal _latestVersion;

    constructor(address owner_) Ownable(owner_) {}

    /// @inheritdoc IReleaseRegistry
    function publish(address implementation, uint64 version, bytes32 notesHash) external onlyOwner {
        if (implementation.code.length == 0) revert NotAContract(implementation);
        if (_releases[implementation].publishedAt != 0) revert AlreadyPublished(implementation);
        if (version <= _latestVersion) revert VersionNotIncreasing(_latestVersion, version);

        _releases[implementation] =
            Release({version: version, publishedAt: uint64(block.timestamp), revoked: false, notesHash: notesHash});
        _latest = implementation;
        _latestVersion = version;
        emit ReleasePublished(implementation, version, notesHash);
    }

    /// @inheritdoc IReleaseRegistry
    function revoke(address implementation) external onlyOwner {
        if (_releases[implementation].publishedAt == 0) revert UnknownRelease(implementation);
        _releases[implementation].revoked = true;
        emit ReleaseRevoked(implementation);
    }

    /// @inheritdoc IReleaseRegistry
    function isPublished(address implementation) external view returns (bool) {
        Release storage r = _releases[implementation];
        return r.publishedAt != 0 && !r.revoked;
    }

    /// @inheritdoc IReleaseRegistry
    function release(address implementation) external view returns (Release memory) {
        return _releases[implementation];
    }

    /// @inheritdoc IReleaseRegistry
    function latest() external view returns (address implementation, uint64 version) {
        return (_latest, _latestVersion);
    }
}
