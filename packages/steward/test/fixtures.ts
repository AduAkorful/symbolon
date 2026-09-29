import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { completeTotals, encodeSealedInvoice, sealInvoice, type DocumentDraft } from "@symbolon/seal";

import { Risk, type Budget, type Payee, type VaultFacts } from "../src/index.js";

export const DAY = 86_400n;
export const USDC = 1_000_000n;
export const NOW = 1_790_000_000n;
export const CHAIN_ID = 5_042_002;
export const LEDGER: Address = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE";
export const TOKEN: Address = "0x3600000000000000000000000000000000000000";
export const VAULT: Address = "0x5F5e2cd9F87A81724Cc48eC0C193630a60692984";
export const ZERO32: Hex = `0x${"00".repeat(32)}`;

export const sealAccount = privateKeyToAccount(keccak256(stringToBytes("steward.test.seal")));
export const payout: Address = "0x530dF8C969BE62aCBDc58aA33bC40027b66007D0";

export function draft(overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  return {
    schema: "symbolon.invoice.v1",
    seal: sealAccount.address.toLowerCase(),
    vendor: { name: "Studio Ana", email: "billing@ana.example" },
    payer: { name: "Acme", vault: VAULT.toLowerCase() },
    invoiceNumber: "INV-0142",
    issuedAt: Number(NOW),
    dueDate: Number(NOW + 30n * DAY),
    currency: { chainId: CHAIN_ID, token: TOKEN.toLowerCase(), symbol: "USDC", decimals: 6 },
    lineItems: [{ description: "Brand identity", quantity: "1", unitPrice: "4000" }],
    taxes: [],
    discounts: [],
    payout: { address: payout.toLowerCase(), domain: 26 },
    earlyPay: [
      { payBy: Number(NOW + 3n * DAY), discountBps: 150 },
      { payBy: Number(NOW + 15n * DAY), discountBps: 75 },
    ],
    attachments: [],
    ...overrides,
  };
}

export async function sealed(overrides: Partial<DocumentDraft> = {}) {
  const { sealed: s, invoice, fingerprint } = await sealInvoice({
    signer: sealAccount,
    chainId: CHAIN_ID,
    ledger: LEDGER,
    document: completeTotals(draft(overrides)),
  });
  return { envelope: encodeSealedInvoice(s), invoice, fingerprint };
}

export function payee(overrides: Partial<Payee> = {}): Payee {
  return {
    exists: true,
    paidCount: 5,
    payout,
    payoutDomain: 26,
    activeAt: NOW - 10n * DAY,
    retireAt: 0n,
    lastChangeNonce: 0n,
    pendingPayout: "0x0000000000000000000000000000000000000000",
    pendingDomain: 0,
    pendingActiveAt: 0n,
    risk: Risk.Low,
    screenedAt: NOW - DAY,
    spendPeriod: NOW / (30n * DAY),
    spentInPeriod: 0n,
    terms: { budget: ZERO32, requirePo: false, requireDelivery: false, monthlyCap: 100_000n * USDC },
    ...overrides,
  };
}

export function facts(overrides: Partial<VaultFacts> = {}, budget: Partial<Budget> = {}): VaultFacts {
  const b: Budget = { exists: true, periodLength: 30n * DAY, periodIndex: NOW / (30n * DAY), cap: 1_000_000n * USDC, spent: 0n, ...budget };
  return {
    now: NOW,
    paused: false,
    policy: {
      perTxCap: 50_000n * USDC,
      autoPayLimit: 5_000n * USDC,
      ownerThreshold: 10_000n * USDC,
      newVendorMinPaid: 0,
      screeningMaxAge: 0n,
      newPayeeDelay: 0n,
      changeCooldown: 3n * DAY,
      looseningDelay: DAY,
      maxBridgeFee: 5n * USDC,
    },
    isSupportedToken: (t) => t.toLowerCase() === TOKEN.toLowerCase(),
    payee: payee(),
    budget: (id) => (id === ZERO32 ? b : undefined),
    purchaseOrder: undefined,
    deliveryConfirmed: false,
    ...overrides,
  };
}
