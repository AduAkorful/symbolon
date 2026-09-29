import {
  bytesToHex,
  encodeFunctionData,
  hexToBytes,
  isAddressEqual,
  isHex,
  parseAbi,
  recoverAddress,
  zeroAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
} from "viem";

import { ERC1271_MAGIC_VALUE } from "./constants.js";
import type { SealMessages, SealPrimaryType, SealTypedData } from "./typedData.js";

/** secp256k1 order / 2: OpenZeppelin `ECDSA` rejects any `s` above it (malleable signatures) */
const SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const ECDSA_SIGNATURE_BYTES = 65;
const ERC1271_ABI = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const ERC1271_RESULT = `${ERC1271_MAGIC_VALUE}${"0".repeat(56)}`;

/** Only what an ERC-1271 check needs; any viem public client fits */
export type SignatureClient = Pick<PublicClient, "getCode" | "call">;

/** Anything that can sign typed data: a viem local account, or a wallet client wrapped with its account */
export interface SealSigner {
  address?: Address;
  signTypedData: LocalAccount["signTypedData"];
}

export type SignatureCheck =
  | { valid: true; method: "ecdsa" | "erc1271" }
  | { valid: false; reason: string };

/**
 * Recovers an ECDSA signer exactly as OpenZeppelin `ECDSA.tryRecover` does: 65 bytes only, `v` 27 or 28, low `s`.
 * Returns undefined for anything the contracts would reject.
 */
export async function recoverSealSigner(hash: Hex, signature: Hex): Promise<Address | undefined> {
  if (!isHex(signature, { strict: true })) return undefined;
  const bytes = hexToBytes(signature);
  if (bytes.length !== ECDSA_SIGNATURE_BYTES) return undefined;
  const r = BigInt(bytesToHex(bytes.subarray(0, 32)));
  const s = BigInt(bytesToHex(bytes.subarray(32, 64)));
  const v = bytes[64];
  if (s > SECP256K1_HALF_ORDER || (v !== 27 && v !== 28) || r === 0n || s === 0n) return undefined;
  try {
    const signer = await recoverAddress({ hash, signature });
    return isAddressEqual(signer, zeroAddress) ? undefined : signer;
  } catch {
    return undefined;
  }
}

/**
 * Mirrors `SealSignature.isValid`: ECDSA first (so an EIP-7702-delegated EOA's own signature works), then ERC-1271
 * if the signer has code. Without a client only the ECDSA path can be checked, and the result says so.
 */
export async function verifySealSignature(args: {
  signer: Address;
  digest: Hex;
  signature: Hex;
  client?: SignatureClient | undefined;
}): Promise<SignatureCheck> {
  const { signer, digest, signature, client } = args;
  if (isAddressEqual(signer, zeroAddress)) return { valid: false, reason: "no signer" };

  const recovered = await recoverSealSigner(digest, signature);
  if (recovered !== undefined && isAddressEqual(recovered, signer)) return { valid: true, method: "ecdsa" };

  if (client === undefined) {
    return { valid: false, reason: "not an ECDSA signature by the signer; a contract-wallet check needs a chain connection" };
  }
  const code = await client.getCode({ address: signer });
  if (code === undefined || code === "0x") return { valid: false, reason: "signature doesn't match the signer" };

  try {
    const { data } = await client.call({
      to: signer,
      data: encodeFunctionData({ abi: ERC1271_ABI, functionName: "isValidSignature", args: [digest, signature] }),
    });
    // same acceptance rule as OpenZeppelin SignatureChecker: at least one word back, starting with the magic value
    if (data !== undefined && data.length >= ERC1271_RESULT.length && data.slice(0, ERC1271_RESULT.length).toLowerCase() === ERC1271_RESULT) {
      return { valid: true, method: "erc1271" };
    }
    return { valid: false, reason: "the signer's wallet rejected the signature" };
  } catch {
    return { valid: false, reason: "the signer's wallet rejected the signature" };
  }
}

/** Signs any Symbolon type with a signer, returning the signature in lowercase hex */
export async function signSealMessage<T extends SealPrimaryType>(
  signer: SealSigner,
  definition: SealTypedData<T>,
): Promise<Hex> {
  // viem's generic signature can't follow the primaryType → types mapping; the runtime definition is exact
  const signature = await signer.signTypedData(definition as never);
  return signature.toLowerCase() as Hex;
}

export type { SealMessages };
