import { describe, expect, it, vi } from "vitest";
import { getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arcTestnet, getDeployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, createTestDb, decisions, earlyPayOffers, invoices, members, notifications, seals, users, syncCursors } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice, sealDomain, signSealMessage, typedData } from "@symbolon/seal";
import { eq } from "drizzle-orm";
import { runSteward, syncLedger, counterOffer, expireOffers, type StewardEnv } from "../src/index.js";

const deployment = getDeployment(arcTestnet.id);
const zero = `0x${"00".repeat(32)}` as Hex;
const addr = () => privateKeyToAccount(generatePrivateKey()).address;

async function fixture(mode: "shadow" | "assist" | "auto" = "assist", due = false) {
  const db = await createTestDb();
  const [owner] = await db.insert(users).values({ wallet: addr().toLowerCase() }).returning();
  const [approver] = await db.insert(users).values({ wallet: addr().toLowerCase() }).returning();
  const [viewer] = await db.insert(users).values({ wallet: addr().toLowerCase() }).returning();
  const vendor = privateKeyToAccount(generatePrivateKey());
  const [vendorUser] = await db.insert(users).values({ wallet: vendor.address.toLowerCase() }).returning();
  await db.insert(seals).values({ address: vendor.address.toLowerCase(), userId: vendorUser!.id, handle: "lifecycle-vendor", displayName: "Vendor" });
  const vault = addr(), payout = addr();
  const [business] = await db.insert(businesses).values({ name: "Lifecycle", chainId: arcTestnet.id, vault: vault.toLowerCase(), stewardMode: mode }).returning();
  await db.insert(members).values([{ businessId: business!.id, userId: owner!.id, role: "owner" }, { businessId: business!.id, userId: approver!.id, role: "approver" }, { businessId: business!.id, userId: viewer!.id, role: "viewer" }]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const document = completeTotals({ schema: "symbolon.invoice.v1", seal: vendor.address.toLowerCase(), vendor: { name: "Vendor" }, payer: { name: "Lifecycle", vault: vault.toLowerCase() }, invoiceNumber: "LC-1", issuedAt: Number(now - 100n), dueDate: Number(due ? now - 1n : now + 30n * 86400n), currency: { chainId: arcTestnet.id, token: deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 }, lineItems: [{ description: "Services", quantity: "1", unitPrice: "100" }], taxes: [], discounts: [], payout: { address: payout.toLowerCase(), domain: 26 }, earlyPay: [], attachments: [] });
  const signed = await sealInvoice({ signer: vendor, chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger, document });
  await db.insert(invoices).values({ businessId: business!.id, fingerprint: signed.fingerprint, chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger.toLowerCase(), seal: vendor.address.toLowerCase(), payerRef: signed.invoice.payerRef, invoiceNumber: "LC-1", token: deployment.tokens.usdc.toLowerCase(), total: signed.invoice.amount, dueDate: new Date(document.dueDate * 1000), envelope: encodeSealedInvoice(signed.sealed), source: "link", status: "verified" });
  const payee = { exists: true, paidCount: 5, payout, payoutDomain: 26, activeAt: now - 1n, retireAt: 0n, lastChangeNonce: 0n, pendingPayout: zeroAddress, pendingDomain: 0, pendingActiveAt: 0n, risk: 0, screenedAt: now, spendPeriod: now / 86400n, spentInPeriod: 0n, terms: { budget: zero, requirePo: false, requireDelivery: false, monthlyCap: 1_000_000_000n } };
  const contracts = { lens: { read: { getVaultState: async () => ({ paused: false, policy: { perTxCap: 1_000_000_000n, autoPayLimit: due ? 0n : 1_000_000_000n, ownerThreshold: 1_000_000_000n, newVendorMinPaid: 0, screeningMaxAge: 0n, newPayeeDelay: 0n, changeCooldown: 0n, looseningDelay: 0n, maxBridgeFee: 0n } }), getPayee: async () => payee, deliveryConfirmed: async () => false, isSupportedToken: async () => true, getBudget: async () => ({ exists: true, periodLength: 86400n, periodIndex: now / 86400n, cap: 1_000_000_000n, spent: 0n }) } }, ledger: { read: { remaining: async () => 0n, status: async () => ({ seen: false, cancelled: false, credited: 0n, total: 0n }), localDomain: async () => 26, tokenMessenger: async () => zeroAddress } }, token: () => ({ read: { balanceOf: async () => 1_000_000_000n } }) } as unknown as SymbolonContracts;
  const client = { getBlock: async () => ({ number: 100n, timestamp: now }), getCode: async () => undefined } as unknown as PublicClient;
  const env: StewardEnv = { db, client, contracts, deployment, program: { enabled: true, minSpreadBps: 2_000, cashCapBps: 5_000 }, bufferDays: 30, reserveYieldBps: 0 };
  if (!due) {
    const validUntil = now + 86400n;
    const signature = await signSealMessage(vendor, typedData(sealDomain(arcTestnet.id, deployment.contracts.invoiceLedger), "EarlyPayOffer", { fingerprint: signed.fingerprint, discountBps: 10, validUntil }));
    await db.insert(earlyPayOffers).values({ fingerprint: signed.fingerprint, discountBps: 10, validUntil: new Date(Number(validUntil) * 1000), signature });
  }
  return { db, env, signed, vendorUser: vendorUser!, owner: owner!, approver: approver!, viewer: viewer!, business: business!, now };
}

describe("real lifecycle notification producers", () => {
  it("assist/shadow recommend a counter without sending; auto sends once and notifies only its vendor", async () => {
    for (const mode of ["assist", "shadow", "auto"] as const) {
      const f = await fixture(mode);
      expect((await runSteward(f.env, f.business.id))[0]!.outcome).toBe("scheduled");
      await runSteward(f.env, f.business.id);
      const counters = (await f.db.select().from(earlyPayOffers)).filter((o) => o.signature === null);
      expect(counters).toHaveLength(mode === "auto" ? 1 : 0);
      const notices = await f.db.select().from(notifications);
      expect(notices).toHaveLength(mode === "auto" ? 1 : 0);
      if (mode === "auto") expect(notices[0]).toMatchObject({ kind: "offer_countered", userId: f.vendorUser.id });
      else expect((await f.db.select().from(decisions)).filter((d) => d.kind === "counter_recommended")).toHaveLength(1);
      await f.db.$client.close();
    }
  });
  it("actual run approval transition notifies owner and approver once, never viewers", async () => {
    const f = await fixture("assist", true);
    await runSteward(f.env, f.business.id); await runSteward(f.env, f.business.id);
    const notices = await f.db.select().from(notifications);
    expect(notices.map((n) => n.userId).sort()).toEqual([f.owner.id, f.approver.id].sort());
    expect(notices.every((n) => n.kind === "approval_needed")).toBe(true);
    await f.db.$client.close();
  });
  it("an expired counter still prevents a second counter and expiry is inclusive", async () => {
    const f = await fixture();
    const first = await counterOffer(f.db, { fingerprint: f.signed.fingerprint, discountBps: 200, validUntil: new Date(Number(f.now + 3600n) * 1000) });
    await expireOffers(f.db, new Date(Number(f.now + 3600n) * 1000));
    expect((await f.db.select().from(earlyPayOffers).where(eq(earlyPayOffers.id, first.id)))[0]!.status).toBe("expired");
    await expect(counterOffer(f.db, { fingerprint: f.signed.fingerprint, discountBps: 300, validUntil: new Date(Number(f.now + 7200n) * 1000) })).rejects.toThrow("already countered once");
    await f.db.$client.close();
  });
  it("ledger sync produces partial-payment and cancellation vendor notices idempotently", async () => {
    const f = await fixture();
    const tx = `0x${"aa".repeat(32)}` as Hex;
    const block = deployment.startBlock;
    const getLogs = vi.fn(async () => [{ eventName: "Settled", args: { fingerprint: f.signed.fingerprint }, address: deployment.contracts.invoiceLedger, transactionHash: tx, logIndex: 0, blockNumber: block }]);
    const client = { ...f.env.client, getLogs, getBlockNumber: async () => block } as unknown as PublicClient;
    const contracts = { ...f.env.contracts, ledger: { read: { status: async () => ({ seen: true, cancelled: false, credited: 50_000_000n, total: 100_000_000n }), remaining: async () => 50_000_000n } } } as unknown as SymbolonContracts;
    await syncLedger(f.db, client, contracts, deployment); await f.db.delete(syncCursors);
    await syncLedger(f.db, client, contracts, deployment);
    const notices = await f.db.select().from(notifications);
    expect(notices).toHaveLength(1); expect(notices[0]).toMatchObject({ userId: f.vendorUser.id, kind: "invoice_paid", body: { partial: true } });
    await f.db.delete(syncCursors);
    getLogs.mockResolvedValue([{ eventName: "Cancelled", args: { fingerprint: f.signed.fingerprint }, address: deployment.contracts.invoiceLedger, transactionHash: tx, logIndex: 1, blockNumber: block }]);
    const cancelled = { ...contracts, ledger: { read: { status: async () => ({ seen: true, cancelled: true, credited: 50_000_000n, total: 100_000_000n }), remaining: async () => 50_000_000n } } } as unknown as SymbolonContracts;
    await syncLedger(f.db, client, cancelled, deployment);
    const after = await f.db.select().from(notifications);
    expect(after).toHaveLength(2);
    expect(after.find(n => n.kind === "invoice_cancelled")).toMatchObject({ userId: f.vendorUser.id, subject: f.signed.fingerprint });

    await f.db.$client.close();
  });
});
