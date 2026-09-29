// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {
    Invoice,
    EarlyPayOffer,
    Cancel,
    CreditNote,
    PayoutChange,
    SealRotation,
    Approval,
    SealTypes
} from "../../src/types/SealTypes.sol";

/// @notice Exposes `SealTypes` struct hashes externally so tests can hash memory structs through calldata
contract SealTypesHarness {
    function hashInvoice(Invoice calldata inv) external pure returns (bytes32) {
        return SealTypes.hash(inv);
    }

    function hashOffer(EarlyPayOffer calldata offer) external pure returns (bytes32) {
        return SealTypes.hash(offer);
    }

    function hashCancel(Cancel calldata c) external pure returns (bytes32) {
        return SealTypes.hash(c);
    }

    function hashCreditNote(CreditNote calldata note) external pure returns (bytes32) {
        return SealTypes.hash(note);
    }

    function hashPayoutChange(PayoutChange calldata change) external pure returns (bytes32) {
        return SealTypes.hash(change);
    }

    function hashSealRotation(SealRotation calldata rotation) external pure returns (bytes32) {
        return SealTypes.hash(rotation);
    }

    function hashApproval(Approval calldata approval) external pure returns (bytes32) {
        return SealTypes.hash(approval);
    }
}
