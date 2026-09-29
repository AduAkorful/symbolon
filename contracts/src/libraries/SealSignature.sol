// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title SealSignature
/// @notice Signature check that accepts both EOAs (including EIP-7702-delegated ones) and ERC-1271 smart accounts
/// @dev OpenZeppelin 5.7's `SignatureChecker.isValidSignatureNow` skips ECDSA whenever the signer has code, which
/// rejects a valid plain signature from an EOA that has an EIP-7702 delegation. ECDSA is therefore tried first.
library SealSignature {
    function isValid(address signer, bytes32 digest, bytes memory signature) internal view returns (bool) {
        if (signer == address(0)) return false;
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        if (signer.code.length == 0) return false;
        return SignatureChecker.isValidERC1271SignatureNow(signer, digest, signature);
    }
}
