import { decodeFunctionData, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { invoiceLedgerAbi, symbolonVaultAbi, toTransaction } from "@symbolon/chain";
import { businesses, createTestDb, members, notifications, users, vendorRequests } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealDomain, sealInvoice, signSealMessage, typedData } from "@symbolon/seal";

import { requestCall, submitVendorRequest } from "../src/index.js";

const CHAIN_ID = 5_042_002;
const LEDGER = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE" as const;
const VAULT = "0x5F5e2cd9F87A81724Cc48eC0C193630a60692984" as const;
const d = { chainId: CHAIN_ID, ledger: LEDGER };
const domain = sealDomain(CHAIN_ID, LEDGER);
const seal = privateKeyToAccount(keccak256(stringToBytes("changes.seal")));
const other = privateKeyToAccount(keccak256(stringToBytes("changes.other")));
const newSeal = privateKeyToAccount(keccak256(stringToBytes("changes.newSeal")));

async function envelope() {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: seal.address.toLowerCase(),
    vendor: { name: "Studio Ana" },
    payer: { name: "Acme", vault: VAULT.toLowerCase() },
    invoiceNumber: "INV-9",
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: { chainId: CHAIN_ID, token: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    lineItems: [{ description: "Work", quantity: "1", unitPrice: "100" }],
    taxes: [],
    discounts: [],
    payout: { address: "0x530df8c969be62acbdc58aa33bc40027b66007d0", domain: 26 },
    earlyPay: [],
    attachments: [],
  });
  const r = await sealInvoice({ signer: seal, chainId: CHAIN_ID, ledger: LEDGER, document });
  return { envelope: encodeSealedInvoice(r.sealed), fingerprint: r.fingerprint };
}

describe("vendor change requests", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let businessId: string;
  beforeEach(async () => {
    db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    const [b] = await db.insert(businesses).values({ name: "Acme", chainId: CHAIN_ID, vault: VAULT.toLowerCase() }).returning();
    businessId = b!.id;
    await db.insert(members).values({ businessId, userId: u!.id, role: "owner" });
  });

  it("stores a Seal-signed payout change, alerts the owner loudly, and builds the owner's confirmation", async () => {
    const message = { seal: seal.address, newPayout: other.address, payoutDomain: 26, nonce: 1n };
    const sig = await signSealMessage(seal, typedData(domain, "PayoutChange", message));
    const { id } = await submitVendorRequest(db, d, businessId, { kind: "payout_change", message }, sig);
    const [note] = await db.select().from(notifications);
    expect(note).toMatchObject({ kind: "vendor_payout_change", subject: id, body: { loud: true } });

    const call = await requestCall(db, d, id, VAULT);
    const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(call).data });
    expect(decoded.functionName).toBe("confirmPayoutChange");
    expect(decoded.args?.[1]).toBe(sig);
  });

  it("refuses a payout change not signed by that Seal", async () => {
    const message = { seal: seal.address, newPayout: other.address, payoutDomain: 26, nonce: 1n };
    const forged = await signSealMessage(other, typedData(domain, "PayoutChange", message));
    await expect(submitVendorRequest(db, d, businessId, { kind: "payout_change", message }, forged)).rejects.toThrow(/signature rejected/);
    expect(await db.select().from(vendorRequests)).toHaveLength(0);
  });

  it("requires a Seal rotation to be signed by the old Seal", async () => {
    const message = { oldSeal: seal.address, newSeal: newSeal.address, nonce: 2n };
    const byNew = await signSealMessage(newSeal, typedData(domain, "SealRotation", message));
    await expect(submitVendorRequest(db, d, businessId, { kind: "seal_rotation", message }, byNew)).rejects.toThrow();
    const byOld = await signSealMessage(seal, typedData(domain, "SealRotation", message));
    const { id } = await submitVendorRequest(db, d, businessId, { kind: "seal_rotation", message }, byOld);
    expect(decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(await requestCall(db, d, id, VAULT)).data }).functionName).toBe("confirmSealRotation");
  });

  it("turns a signed cancellation and a credit note into ledger calls anyone can submit", async () => {
    const { envelope: env, fingerprint } = await envelope();
    const cancelSig = await signSealMessage(seal, typedData(domain, "Cancel", { fingerprint }));
    const c = await submitVendorRequest(db, d, businessId, { kind: "cancel", envelope: env }, cancelSig);
    const cancel = decodeFunctionData({ abi: invoiceLedgerAbi, data: toTransaction(await requestCall(db, d, c.id)).data });
    expect(cancel.functionName).toBe("cancel");

    const note = { fingerprint, amount: 10_000_000n, documentHash: keccak256(stringToBytes("note")) as Hex, nonce: 1n };
    const noteSig = await signSealMessage(seal, typedData(domain, "CreditNote", note));
    const n = await submitVendorRequest(db, d, businessId, { kind: "credit_note", envelope: env, message: note }, noteSig);
    const applied = decodeFunctionData({ abi: invoiceLedgerAbi, data: toTransaction(await requestCall(db, d, n.id)).data });
    expect(applied.functionName).toBe("applyCreditNote");

    const wrongInvoice = { ...note, fingerprint: keccak256(stringToBytes("x")) as Hex };
    const wrongSig = await signSealMessage(seal, typedData(domain, "CreditNote", wrongInvoice));
    await expect(submitVendorRequest(db, d, businessId, { kind: "credit_note", envelope: env, message: wrongInvoice }, wrongSig)).rejects.toThrow(/another invoice/);
  });

  it("never stores the same signed request twice", async () => {
    const message = { seal: seal.address, newPayout: other.address, payoutDomain: 26, nonce: 1n };
    const sig = await signSealMessage(seal, typedData(domain, "PayoutChange", message));
    await submitVendorRequest(db, d, businessId, { kind: "payout_change", message }, sig);
    await expect(submitVendorRequest(db, d, businessId, { kind: "payout_change", message }, sig)).rejects.toThrow();
  });
});
