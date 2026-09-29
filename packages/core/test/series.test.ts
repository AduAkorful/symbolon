import { decodeFunctionData, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { symbolonVaultAbi, toTransaction } from "@symbolon/chain";
import { businesses, createTestDb, deliveries, invoices, seriesInvoices } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice, seriesDrafts, type DocumentDraft } from "@symbolon/seal";

import { confirmDelivery, createSeries, receiveInvoice, rejectDelivery, releaseDue } from "../src/index.js";
import { notifications, seals, users } from "@symbolon/db";

const CHAIN_ID = 5_042_002;
const LEDGER = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE" as const;
const VAULT = "0x5F5e2cd9F87A81724Cc48eC0C193630a60692984" as const;
const d = { chainId: CHAIN_ID, ledger: LEDGER };
const seal = privateKeyToAccount(keccak256(stringToBytes("series.seal")));
const other = privateKeyToAccount(keccak256(stringToBytes("series.other")));
const START = 1_790_000_000;

const template = (signer = seal): DocumentDraft => ({
  schema: "symbolon.invoice.v1",
  seal: signer.address.toLowerCase(),
  vendor: { name: "Studio Ana" },
  payer: { name: "Acme", vault: VAULT.toLowerCase() },
  invoiceNumber: "RET",
  issuedAt: START,
  dueDate: START + 30 * 86_400,
  currency: { chainId: CHAIN_ID, token: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
  lineItems: [{ description: "Monthly retainer", quantity: "1", unitPrice: "4000" }],
  taxes: [],
  discounts: [],
  payout: { address: "0x530df8c969be62acbdc58aa33bc40027b66007d0", domain: 26 },
  earlyPay: [],
  attachments: [],
});

async function sealAll(drafts: DocumentDraft[], signer = seal) {
  return Promise.all(
    drafts.map(async (doc) => encodeSealedInvoice((await sealInvoice({ signer, chainId: CHAIN_ID, ledger: LEDGER, document: completeTotals(doc) })).sealed)),
  );
}

describe("recurring series and milestones", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(businesses).values({ name: "Acme", chainId: CHAIN_ID, vault: VAULT.toLowerCase() });
  });

  it("releases each pre-sealed period once, only when due", async () => {
    const envelopes = await sealAll(seriesDrafts(template(), { start: START, periods: 3, every: "monthly", dueAfterDays: 30 }));
    const { periods } = await createSeries(db, d, envelopes, { description: "Retainer" });
    expect(periods).toBe(3);

    expect(await releaseDue(db, d, new Date(START * 1000 - 1))).toHaveLength(0);
    const first = await releaseDue(db, d, new Date(START * 1000));
    expect(first.map((r) => r.status)).toEqual(["verified"]);
    expect(await releaseDue(db, d, new Date(START * 1000 + 1))).toHaveLength(0); // not twice
    const rest = await releaseDue(db, d, new Date((START + 70 * 86_400) * 1000));
    expect(rest).toHaveLength(2);
    const stored = await db.select().from(invoices);
    expect(stored.map((i) => i.source)).toEqual(["recurring", "recurring", "recurring"]);
    expect(stored.every((i) => i.businessId)).toBe(true);
  });

  it("refuses a series mixing Seals or out of order", async () => {
    const mine = await sealAll(seriesDrafts(template(), { start: START, periods: 2, every: "monthly", dueAfterDays: 30 }));
    const theirs = await sealAll([template(other)], other);
    await expect(createSeries(db, d, [mine[0]!, theirs[0]!])).rejects.toThrow(/same Seal/);
    await expect(createSeries(db, d, [mine[1]!, mine[0]!])).rejects.toThrow(/increasing/);
    await expect(createSeries(db, d, [mine[0]!.replace("Monthly", "Weekly")])).rejects.toThrow(/valid sealed invoice/);
    expect(await db.select().from(seriesInvoices)).toHaveLength(0);
  });

  it("records delivery evidence and builds the requester's confirmation", async () => {
    const [biz] = await db.select().from(businesses);
    const fp = keccak256(stringToBytes("milestone-1"));
    const call = await confirmDelivery(db, { businessId: biz!.id, vault: VAULT, fingerprint: fp, source: "github", evidence: { pr: "acme/site#42", merged: true } });
    expect(decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(call).data })).toMatchObject({ functionName: "confirmDelivery", args: [fp] });
    const [row] = await db.select().from(deliveries);
    expect(row).toMatchObject({ source: "github", evidence: { pr: "acme/site#42", merged: true } });
  });

  it("rejects a delivery: holds the invoice, tells the vendor why, and builds the onchain call", async () => {
    const [biz] = await db.select().from(businesses);
    const [vendorUser] = await db.insert(users).values({ email: "ana@studio.example" }).returning();
    await db.insert(seals).values({ address: seal.address.toLowerCase(), userId: vendorUser!.id, handle: "studio-ana", displayName: "Studio Ana" });
    const [envelope] = await sealAll([template()]);
    const intake = await receiveInvoice(db, d, envelope!, "link");
    const call = await rejectDelivery(db, { businessId: biz!.id, vault: VAULT, fingerprint: intake.fingerprint!, reason: "Missing the mobile layouts" });
    const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(call).data });
    expect(decoded.functionName).toBe("rejectDelivery");
    expect(decoded.args?.[1]).toBe(keccak256(stringToBytes("Missing the mobile layouts")));
    expect((await db.select().from(invoices))[0]!.status).toBe("held");
    expect((await db.select().from(notifications))[0]).toMatchObject({ userId: vendorUser!.id, kind: "delivery_rejected" });
    await expect(rejectDelivery(db, { businessId: biz!.id, vault: VAULT, fingerprint: intake.fingerprint!, reason: "  " })).rejects.toThrow(/why/);
  });
});
