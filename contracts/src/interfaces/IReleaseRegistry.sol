// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title IReleaseRegistry
/// @notice Symbolon's list of published Vault implementations. Only Vaults whose owner opted in to auto-update ever
/// follow it, and only after each Vault's own delay.
interface IReleaseRegistry {
    /// @notice A published Vault implementation
    /// @param version Monotonically increasing release number
    /// @param publishedAt When it was published (0 if never)
    /// @param revoked True once it may no longer be auto-applied
    /// @param notesHash Hash of the release notes and audit references
    struct Release {
        uint64 version;
        uint64 publishedAt;
        bool revoked;
        bytes32 notesHash;
    }

    event ReleasePublished(address indexed implementation, uint64 indexed version, bytes32 notesHash);
    event ReleaseRevoked(address indexed implementation);

    error NotAContract(address implementation);
    error VersionNotIncreasing(uint64 latest, uint64 version);
    error AlreadyPublished(address implementation);
    error UnknownRelease(address implementation);

    /// @notice Publishes a new Vault implementation
    function publish(address implementation, uint64 version, bytes32 notesHash) external;

    /// @notice Stops a release from being auto-applied, including where it is already scheduled
    function revoke(address implementation) external;

    /// @notice True if `implementation` is published and not revoked
    function isPublished(address implementation) external view returns (bool);

    /// @notice The release record for an implementation
    function release(address implementation) external view returns (Release memory);

    /// @notice The most recently published implementation and its version (revoked or not)
    function latest() external view returns (address implementation, uint64 version);
}
