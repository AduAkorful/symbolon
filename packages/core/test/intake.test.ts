import { eq } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { businesses, createTestDb, invoices } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";

import { receiveInvoice, vaultFromPayerRef } from "../src/index.js";

const CHAIN_ID = 5_042_002;
const LEDGER = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE" as const;
const VAULT = "0x5f5e2cd9f87a81724cc48ec0c193630a60692984";
const seal = privateKeyToAccount(keccak256(stringToBytes("core.test.seal")));

async function sealedEnvelope(payer: object = { name: "Acme", vault: VAULT }, number = "INV-1") {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: seal.address.toLowerCase(),
    vendor: { name: "Studio Ana" },
    payer: payer as never,
    invoiceNumber: number,
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
  const { sealed, fingerprint } = await sealInvoice({ signer: seal, chainId: CHAIN_ID, ledger: LEDGER, document });
  return { envelope: encodeSealedInvoice(sealed), fingerprint };
}

describe("invoice intake", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("verifies, stores once and links to the payer's business by its Vault", async () => {
    const [biz] = await db.insert(businesses).values({ name: "Acme", chainId: CHAIN_ID, vault: VAULT }).returning();
    const { envelope, fingerprint } = await sealedEnvelope();
    const first = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, envelope, "link");
    expect(first).toMatchObject({ status: "verified", fingerprint, duplicate: false, businessId: biz!.id });
    const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint));
    expect(row).toMatchObject({ total: 100_000_000n, status: "verified", invoiceNumber: "INV-1", seal: seal.address.toLowerCase() });
    expect(row!.issuedAt?.getTime()).toBe(1_790_000_000_000);
    expect((await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, envelope, "email")).duplicate).toBe(true);
  });

  it("keeps an email payer unlinked until matched", async () => {
    const { envelope } = await sealedEnvelope({ name: "Acme", email: "ap@acme.example" });
    const r = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, envelope, "email");
    expect(r.status).toBe("verified");
    expect(r.businessId).toBeUndefined();
  });

  it("does not store a tampered invoice under its fingerprint", async () => {
    const { envelope } = await sealedEnvelope();
    const tampered = envelope.replace('"Work"', '"Worx"');
    const r = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, tampered, "upload");
    expect(r.status).toBe("rejected");
    expect(r.issues.map((i) => i.code)).toContain("signature");
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it("lets a genuine submission claim a fingerprint after a bad signature", async () => {
    const { envelope, fingerprint } = await sealedEnvelope();
    const badSignature = JSON.stringify({ ...JSON.parse(envelope), signature: `0x${"00".repeat(65)}` });
    const bad = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, badSignature, "upload");
    expect(bad.status).toBe("rejected");
    const good = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, envelope, "link");
    expect(good).toMatchObject({ status: "verified", fingerprint, duplicate: false });
    expect(await db.select({ status: invoices.status }).from(invoices)).toEqual([{ status: "verified" }]);
  });

  it("does not change a genuine row when a bad submission follows it", async () => {
    const { envelope, fingerprint } = await sealedEnvelope();
    await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, envelope, "link");
    const badSignature = JSON.stringify({ ...JSON.parse(envelope), signature: `0x${"00".repeat(65)}` });
    const bad = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, badSignature, "upload");
    expect(bad).toMatchObject({ status: "rejected", fingerprint, duplicate: true });
    expect(await db.select({ status: invoices.status }).from(invoices)).toEqual([{ status: "verified" }]);
  });

  it("refuses an invoice sealed for another ledger", async () => {
    const { envelope } = await sealedEnvelope();
    const r = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: VAULT as never }, envelope, "api");
    expect(r.status).toBe("rejected");
    expect(r.issues.map((i) => i.code)).toContain("chain_mismatch");
  });

  it("drops malformed input without storing anything", async () => {
    const r = await receiveInvoice(db, { chainId: CHAIN_ID, ledger: LEDGER }, "{not json", "api");
    expect(r).toMatchObject({ status: "rejected", duplicate: false });
    expect(await db.select().from(invoices)).toHaveLength(0);
  });

  it("reads a Vault out of payerRef only when it's a padded address", () => {
    expect(vaultFromPayerRef(`0x${"00".repeat(12)}${VAULT.slice(2)}`)?.toLowerCase()).toBe(VAULT);
    expect(vaultFromPayerRef(keccak256(stringToBytes("ap@acme.example")))).toBeUndefined();
  });
});
