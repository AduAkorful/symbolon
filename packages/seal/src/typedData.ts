import { getAddress, hashStruct, hashTypedData, type Address, type Hex, type TypedDataDomain } from "viem";

import { DOMAIN_NAME, DOMAIN_VERSION } from "./constants.js";

// Field order and types must match contracts/src/types/SealTypes.sol exactly; the known vectors enforce it.
const EARLY_PAY_TIER = [
  { name: "payBy", type: "uint64" },
  { name: "discountBps", type: "uint16" },
] as const;

export const sealTypes = {
  Invoice: {
    Invoice: [
      { name: "seal", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "issuedAt", type: "uint64" },
      { name: "dueDate", type: "uint64" },
      { name: "payoutAddress", type: "address" },
      { name: "payoutDomain", type: "uint32" },
      { name: "payerRef", type: "bytes32" },
      { name: "invoiceNumberHash", type: "bytes32" },
      { name: "poRef", type: "bytes32" },
      { name: "documentHash", type: "bytes32" },
      { name: "replaces", type: "bytes32" },
      { name: "earlyPay", type: "EarlyPayTier[]" },
    ],
    EarlyPayTier: EARLY_PAY_TIER,
  },
  EarlyPayOffer: {
    EarlyPayOffer: [
      { name: "fingerprint", type: "bytes32" },
      { name: "discountBps", type: "uint16" },
      { name: "validUntil", type: "uint64" },
    ],
  },
  Cancel: {
    Cancel: [{ name: "fingerprint", type: "bytes32" }],
  },
  CreditNote: {
    CreditNote: [
      { name: "fingerprint", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "documentHash", type: "bytes32" },
      { name: "nonce", type: "uint64" },
    ],
  },
  PayoutChange: {
    PayoutChange: [
      { name: "seal", type: "address" },
      { name: "newPayout", type: "address" },
      { name: "payoutDomain", type: "uint32" },
      { name: "nonce", type: "uint64" },
    ],
  },
  SealRotation: {
    SealRotation: [
      { name: "oldSeal", type: "address" },
      { name: "newSeal", type: "address" },
      { name: "nonce", type: "uint64" },
    ],
  },
  Approval: {
    Approval: [
      { name: "vault", type: "address" },
      { name: "fingerprint", type: "bytes32" },
      { name: "credit", type: "uint256" },
      { name: "deadline", type: "uint64" },
    ],
  },
} as const;

export interface EarlyPayTier {
  payBy: bigint;
  discountBps: number;
}

/** The vendor's signed half of a payment (`SealTypes.sol` `Invoice`) */
export interface Invoice {
  seal: Address;
  token: Address;
  amount: bigint;
  issuedAt: bigint;
  dueDate: bigint;
  payoutAddress: Address;
  payoutDomain: number;
  payerRef: Hex;
  invoiceNumberHash: Hex;
  poRef: Hex;
  documentHash: Hex;
  replaces: Hex;
  earlyPay: readonly EarlyPayTier[];
}

export interface EarlyPayOffer {
  fingerprint: Hex;
  discountBps: number;
  validUntil: bigint;
}

export interface Cancel {
  fingerprint: Hex;
}

export interface CreditNote {
  fingerprint: Hex;
  amount: bigint;
  documentHash: Hex;
  nonce: bigint;
}

export interface PayoutChange {
  seal: Address;
  newPayout: Address;
  payoutDomain: number;
  nonce: bigint;
}

export interface SealRotation {
  oldSeal: Address;
  newSeal: Address;
  nonce: bigint;
}

export interface Approval {
  vault: Address;
  fingerprint: Hex;
  credit: bigint;
  deadline: bigint;
}

export interface SealMessages {
  Invoice: Invoice;
  EarlyPayOffer: EarlyPayOffer;
  Cancel: Cancel;
  CreditNote: CreditNote;
  PayoutChange: PayoutChange;
  SealRotation: SealRotation;
  Approval: Approval;
}

export type SealPrimaryType = keyof SealMessages;

/** The domain every Symbolon signature lives in: one ledger on one chain */
export interface SealDomain {
  name: typeof DOMAIN_NAME;
  version: typeof DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
}

export function sealDomain(chainId: number, ledger: Address): SealDomain {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError(`invalid chain id ${chainId}`);
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: getAddress(ledger) };
}

/** A full EIP-712 definition, ready for any viem signer (`account.signTypedData(def)`) */
export interface SealTypedData<T extends SealPrimaryType> {
  domain: SealDomain;
  types: (typeof sealTypes)[T];
  primaryType: T;
  message: SealMessages[T];
}

export function typedData<T extends SealPrimaryType>(
  domain: SealDomain,
  primaryType: T,
  message: SealMessages[T],
): SealTypedData<T> {
  return { domain, types: sealTypes[primaryType], primaryType, message };
}

/** `SealTypes.hash(...)` for any signed type */
export function structHash<T extends SealPrimaryType>(primaryType: T, message: SealMessages[T]): Hex {
  // viem's generic inference can't follow the primaryType → types mapping; the runtime values are exact
  return hashStruct({ data: message, primaryType, types: sealTypes[primaryType] } as never);
}

/** The EIP-712 digest a Seal (or approver) signs: `InvoiceLedger.hashTypedData(structHash)` */
export function digest<T extends SealPrimaryType>(domain: SealDomain, primaryType: T, message: SealMessages[T]): Hex {
  return hashTypedData(typedData(domain, primaryType, message) as never);
}

/** An invoice's fingerprint: its EIP-712 digest, identical to `InvoiceLedger.fingerprint(invoice)` */
export function fingerprint(domain: SealDomain, invoice: Invoice): Hex {
  return digest(domain, "Invoice", invoice);
}

const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

/**
 * The `eth_signTypedData_v4` payload as plain JSON (integers as decimal strings), for wallets and SDKs that take a
 * JSON string rather than viem values.
 */
export function typedDataJson<T extends SealPrimaryType>(domain: SealDomain, primaryType: T, message: SealMessages[T]): string {
  const payload = {
    types: { EIP712Domain: EIP712_DOMAIN_TYPE, ...sealTypes[primaryType] },
    domain: domain satisfies TypedDataDomain,
    primaryType,
    message,
  };
  return JSON.stringify(payload, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
}
