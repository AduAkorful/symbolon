import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { arcTestnet, getDeployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, createTestDb, decisions, earlyPayOffers, invoices, payees, screenings } from "@symbolon/db";
import { createInvoiceInputReader } from "../src/invoice-inputs.js";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.$client.close(); });
const deployment = getDeployment(arcTestnet.id);
const address = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
const hash = () => keccak256(stringToHex(crypto.randomUUID()));
const day = 86400n;

async function fixture() {
  const vault = address();
  const [business] = await db.insert(businesses).values({ name: "Input reader", chainId: arcTestnet.id, vault, bufferDays: 7 }).returning();
  const [other] = await db.insert(businesses).values({ name: "Other business", chainId: arcTestnet.id, vault: address() }).returning();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const seal = address();
  const row = (businessId = business!.id, extra: Partial<typeof invoices.$inferInsert> = {}) => ({
    businessId, fingerprint: hash(), chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger,
    seal, payerRef: hash(), invoiceNumber: crypto.randomUUID(), token: deployment.tokens.usdc,
    total: 100n, credited: 0n, dueDate: new Date(Number(now + day) * 1000), envelope: "{}", source: "link" as const,
    status: "verified" as const, ...extra,
  });
  const target = row();
  await db.insert(invoices).values(target);
  const balanceOf = vi.fn().mockResolvedValue(500n);
  const env = { db, deployment, bufferDays: 7, contracts: { token: () => ({ read: { balanceOf } }) } as unknown as SymbolonContracts };
  return { env, vault, business: business!, other: other!, target, now, row, balanceOf };
}

describe("shared runner and wallet payment inputs", () => {
  it("uses live cash and selected buffer, excluding target/human holds and the other business", async () => {
    const f = await fixture();
    const near = f.row(f.business.id, { total: 90n, credited: 20n });
    const far = f.row(f.business.id, { dueDate: new Date(Number(f.now + 8n * day) * 1000) });
    const human = f.row(f.business.id, { status: "held", holdSource: "human" });
    await db.insert(invoices).values([near, far, human, f.row(f.other.id)]);
    const reader = await createInvoiceInputReader(f.env, f.business.id, f.vault);
    const inputs = await reader.forInvoice(f.target, f.now);
    expect(inputs.operatingCash).toBe(500n);
    expect(inputs.buffer).toBe(70n);
    expect(f.balanceOf).toHaveBeenCalledWith([f.vault]);
    expect(inputs.knownInvoices.map((i) => i.fingerprint)).toEqual(expect.arrayContaining([near.fingerprint, far.fingerprint, human.fingerprint]));
    expect(inputs.knownInvoices).toHaveLength(3);
  });
  it("loads current vendor blocks, signed open offers and only successfully recorded screening addresses", async () => {
    const f = await fixture();
    await db.insert(payees).values({ businessId: f.business.id, seal: f.target.seal, status: "blocked" });
    const [recorded] = await db.insert(screenings).values({ businessId: f.business.id, seal: f.target.seal, address: address(), risk: 0, result: "APPROVED", provider: "Circle", screenedAt: new Date() }).returning();
    await db.insert(screenings).values({ businessId: f.business.id, seal: f.target.seal, address: address(), risk: 0, result: "APPROVED", provider: "Circle", screenedAt: new Date(Date.now() + 1000) });
    await db.insert(decisions).values({ businessId: f.business.id, kind: "screening_recorded", hash: hash(), record: { inputs: { screeningId: recorded!.id } } });
    await db.insert(earlyPayOffers).values([
      { fingerprint: f.target.fingerprint, discountBps: 200, validUntil: new Date(Number(f.now + day) * 1000), signature: "0xab", status: "open" },
      { fingerprint: f.target.fingerprint, discountBps: 300, validUntil: new Date(Number(f.now + day) * 1000), status: "open" },
    ]);
    const reader = await createInvoiceInputReader(f.env, f.business.id, f.vault);
    const inputs = await reader.forInvoice(f.target, f.now);
    expect(inputs.blockedSeal).toBe(true);
    expect(inputs.latestScreenedAddress).toBe(recorded!.address);
    expect(inputs.offers).toEqual([{ discountBps: 200, validUntil: f.now + day, signature: "0xab" }]);
  });
  it("shares the existing rolling commitment calculation and per-pass cash snapshot", async () => {
    const f = await fixture();
    await db.insert(decisions).values([
      { businessId: f.business.id, kind: "pay", hash: hash(), record: { inputs: { timing: "pay_now_discounted", paid: "25" } } },
      { businessId: f.other.id, kind: "pay", hash: hash(), record: { inputs: { timing: "pay_now_discounted", paid: "999" } } },
      { businessId: f.business.id, kind: "pay", hash: hash(), record: { inputs: { timing: "pay_now_discounted", paid: "40" } }, createdAt: new Date(Date.now() - 31 * 86400_000) },
    ]);
    const reader = await createInvoiceInputReader(f.env, f.business.id, f.vault);
    f.balanceOf.mockResolvedValue(0n);
    const first = await reader.forInvoice(f.target, f.now);
    const second = await reader.forInvoice(f.target, f.now);
    expect(first.earlyPayCommitted).toBe(25n);
    expect(second.operatingCash).toBe(500n);
    expect(f.balanceOf).toHaveBeenCalledTimes(1);
  });
  it("rejects a failed mandatory cash read instead of inventing liquidity", async () => {
    const f = await fixture();
    f.balanceOf.mockRejectedValue(new Error("Token RPC unavailable"));
    await expect(createInvoiceInputReader(f.env, f.business.id, f.vault)).rejects.toThrow("Token RPC unavailable");
  });
});
