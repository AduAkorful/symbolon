import "server-only";

import type { PublicClient } from "viem";
import { getAddress, verifyTypedData } from "viem";

import { AuthError } from "./errors";
import type { RegistrationFields } from "./vendor";

// Plan 05zo (QA SYM-12). The wallet signs the handle, name and website it registers, so a display name is never a server record
// alone. Off-chain only: the domain has no verifying contract, so it can't be confused with the ledger's invoice domain.

export const REGISTRATION_TYPES = {
  SealRegistration: [
    { name: "wallet", type: "address" },
    { name: "handle", type: "string" },
    { name: "displayName", type: "string" },
    { name: "website", type: "string" },
    { name: "issuedAt", type: "uint256" },
  ],
} as const;

/** How long a prepared registration can be signed and sent */
export const REGISTRATION_VALID_SECONDS = 15 * 60;
const CLOCK_SKEW_SECONDS = 60;

export function registrationTypedData(chainId: number, wallet: string, fields: RegistrationFields, issuedAt: number) {
  return {
    domain: { name: "Symbolon Seal registration", version: "1", chainId },
    types: REGISTRATION_TYPES,
    primaryType: "SealRegistration" as const,
    message: { wallet: getAddress(wallet), handle: fields.handle, displayName: fields.displayName, website: fields.website, issuedAt: BigInt(issuedAt) },
  };
}

/** The exact payload the wallet is asked for (JSON, as `eth_signTypedData_v4` takes it) */
export function registrationTypedDataJson(chainId: number, wallet: string, fields: RegistrationFields, issuedAt: number): string {
  const t = registrationTypedData(chainId, wallet, fields, issuedAt);
  return JSON.stringify({
    domain: t.domain,
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }], ...t.types },
    primaryType: t.primaryType,
    message: { ...t.message, issuedAt: t.message.issuedAt.toString() },
  });
}

/** Checks the signature is the account's own wallet over exactly these fields, and recent. Throws a plain refusal otherwise. */
export async function checkRegistrationSignature(
  client: PublicClient,
  chainId: number,
  wallet: string,
  fields: RegistrationFields,
  issuedAt: unknown,
  signature: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)) throw new AuthError(400, "Sign the registration your wallet was shown.");
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || nowSeconds - issuedAt > REGISTRATION_VALID_SECONDS) {
    throw new AuthError(400, "That signature has expired. Start the registration again.");
  }
  if (typeof signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) {
    throw new AuthError(400, "Registering a Seal needs your wallet's signature.");
  }
  const t = registrationTypedData(chainId, wallet, fields, issuedAt);
  const args = { address: getAddress(wallet), signature: signature as `0x${string}`, domain: t.domain, types: t.types, primaryType: t.primaryType, message: t.message };
  // an ordinary wallet is checked locally; a contract wallet (ERC-1271) only the chain can answer
  let valid = await verifyTypedData(args).catch(() => false);
  if (!valid) try {
    valid = await client.verifyTypedData(args);
  } catch {
    valid = false;
  }
  if (!valid) throw new AuthError(400, "That signature doesn't match your wallet and these details. Start the registration again.");
}
