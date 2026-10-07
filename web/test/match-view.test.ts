import { describe, expect, it } from "vitest";
import type { Invoice } from "@symbolon/seal";
import type { Verification } from "@symbolon/seal";
import type { MatchResult, Payee, PayeeTerms, VaultFacts, VaultPolicy } from "@symbolon/steward";
import type { InvoiceStatus } from "@symbolon/chain";
import { evidenceFor } from "@/lib/server/match-view";

const address = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const otherAddress = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const bytes32 = `0x${"11".repeat(32)}` as `0x${string}`;
const zero = `0x${"00".repeat(32)}` as `0x${string}`;

const terms: PayeeTerms = { budget: bytes32, requirePo: false, requireDelivery: false, monthlyCap: 10_000n };
const policy: VaultPolicy = {
  perTxCap: 10_000n,
  autoPayLimit: 10_000n,
  ownerThreshold: 10_000n,
  newVendorMinPaid: 0,
  screeningMaxAge: 100n,
  newPayeeDelay: 0n,
  changeCooldown: 100n,
  looseningDelay: 100n,
  maxBridgeFee: 0n,
};
const invoice: Invoice = {
  seal: address,
  token: address,
  amount: 100n,
  issuedAt: 1n,
  dueDate: 2n,
  payoutAddress: otherAddress,
  payoutDomain: 26,
  payerRef: bytes32,
  invoiceNumberHash: bytes32,
  poRef: zero,
  documentHash: bytes32,
  replaces: zero,
  earlyPay: [],
};
const verification: Verification = { ok: true, issues: [] };
const ledger: InvoiceStatus = { seen: false, seal: address, total: 0n, credited: 0n, cancelled: false, remaining: 0n, paid: false };
const match: MatchResult = { kind: "invoice_only", ok: true, problems: [] };
const payee: Payee = {
  exists: true,
  paidCount: 0,
  payout: otherAddress,
  payoutDomain: 26,
  activeAt: 0n,
  retireAt: 0n,
  lastChangeNonce: 0n,
  pendingPayout: address,
  pendingDomain: 0,
  pendingActiveAt: 0n,
  risk: 0,
  screenedAt: 50n,
  spendPeriod: 0n,
  spentInPeriod: 0n,
  terms,
};
const facts: VaultFacts = {
  now: 100n,
  paused: false,
  policy,
  isSupportedToken: () => true,
  payee,
  budget: () => undefined,
  purchaseOrder: undefined,
  deliveryConfirmed: false,
};

function view(overrides: Partial<Parameters<typeof evidenceFor>[0]> = {}) {
  return evidenceFor({ verification, invoice, trust: "verified", facts, ledger, match, ...overrides });
}

describe("evidenceFor", () => {
  it("a purchase order whose live state couldn't be read blocks and says so (plan 05y Q1)", () => {
    const result = view({ invoice: { ...invoice, poRef: bytes32 }, dbPo: { poNumber: "PO-1", open: false, remainingRaw: null, releaseAfter: null, openTx: null, closedAt: null } });
    const po = result.rows.find((row) => row.label === "Purchase order");
    expect(po?.state).toBe("blocks");
    expect(po?.value).toContain("can't confirm");
    expect(result.matched).toBe(false);
  });

  it("closes only when every check has evidence", () => {
    const result = view();
    expect(result.matched).toBe(true);
    expect(result.rows.map((row) => row.label)).toEqual([
      "Sealed invoice", "Vendor trust", "Vault", "Supported token", "Payee onchain", "Payee payout", "Payee active", "Screening", "Purchase order", "Delivery", "Ledger", "Duplicates",
    ]);
  });

  it.each([
    ["bad signature", { verification: { ok: false, issues: [] } as Verification }],
    ["new vendor", { trust: "new_vendor" as const }],
    ["chain read failure", { facts: undefined }],
    ["payout mismatch", { facts: { ...facts, payee: { ...payee, payout: address } } }],
    ["stale screening", { facts: { ...facts, payee: { ...payee, screenedAt: 0n } } }],
    ["duplicate", { duplicates: [{ kind: "same_number", fingerprint: bytes32, detail: "same number" }] }],
    ["ledger read failure", { ledger: undefined }],
    ["already paid", { ledger: { ...ledger, seen: true, paid: true } }],
    ["cancelled", { ledger: { ...ledger, cancelled: true } }],
    ["match failure", { match: { kind: "invoice_only", ok: false, problems: ["delivery not confirmed"] } }],
  ] as const)("never marks %s as matched", (_name, overrides) => {
    expect(view(overrides as unknown as Partial<Parameters<typeof evidenceFor>[0]>).matched).toBe(false);
  });

  it("does not require screening when the Vault's max age is zero, and says so", () => {
    const noScreening = { ...facts, policy: { ...policy, screeningMaxAge: 0n }, payee: { ...payee, screenedAt: 0n } };
    const result = view({ facts: noScreening });
    expect(result.rows.find((r) => r.label === "Screening")).toMatchObject({ state: "info" });
    expect(result.matched).toBe(true);
  });

  it("still blocks a payee that screening blocked, even when screening isn't required", () => {
    const blocked = { ...facts, policy: { ...policy, screeningMaxAge: 0n }, payee: { ...payee, risk: 3, screenedAt: 0n } };
    expect(view({ facts: blocked }).matched).toBe(false);
  });
});
