import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { businesses, createTestDb, decisions, deliveries, invoices, payees, purchaseOrders, seals, sessions, unsignedBills, users, vendorClients, vendorInvitations, vendorVerifications } from "../src/index.js";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

const SEAL = `0x${"ab".repeat(20)}`;
const FP = `0x${"cd".repeat(32)}`;

async function seed(db: TestDb) {
  const [user] = await db.insert(users).values({ email: "ana@studio.example" }).returning();
  await db.insert(seals).values({ address: SEAL, userId: user!.id, handle: "studio-ana", displayName: "Studio Ana" });
  const [biz] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002 }).returning();
  return { user: user!, biz: biz! };
}

function invoiceRow(businessId: string, overrides: Partial<typeof invoices.$inferInsert> = {}) {
  return {
    fingerprint: FP,
    chainId: 5_042_002,
    ledger: `0x${"11".repeat(20)}`,
    seal: SEAL,
    businessId,
    payerRef: `0x${"00".repeat(32)}`,
    invoiceNumber: "INV-0142",
    token: `0x${"36".repeat(20)}`,
    total: 4_326_000_000n,
    dueDate: new Date("2026-10-26T00:00:00Z"),
    envelope: "{}",
    source: "link",
    ...overrides,
  } satisfies typeof invoices.$inferInsert;
}

describe("schema", () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("applies every migration to an empty database", async () => {
    const tables = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    expect((tables.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(15);
  });

  it("stores amounts exactly as bigint, far beyond float precision", async () => {
    const { biz } = await seed(db);
    const huge = 2n ** 200n + 1n;
    await db.insert(invoices).values(invoiceRow(biz.id, { total: huge }));
    const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, FP));
    expect(row!.total).toBe(huge);
    expect(row!.credited).toBe(0n);
  });

  it("rejects malformed addresses, hashes and emails", async () => {
    const { biz, user } = await seed(db);
    await expect(db.insert(users).values({ email: "Bob@Example.com" })).rejects.toThrow();
    await expect(db.insert(seals).values({ address: SEAL.toUpperCase(), userId: user.id, handle: "x-y", displayName: "x" })).rejects.toThrow();
    await expect(db.insert(invoices).values(invoiceRow(biz.id, { fingerprint: "0x1234" }))).rejects.toThrow();
  });

  it("never lets credited exceed the total or a total be zero", async () => {
    const { biz } = await seed(db);
    await expect(db.insert(invoices).values(invoiceRow(biz.id, { total: 0n }))).rejects.toThrow();
    await expect(db.insert(invoices).values(invoiceRow(biz.id, { total: 10n, credited: 11n }))).rejects.toThrow();
  });

  it("keeps one row per fingerprint", async () => {
    const { biz } = await seed(db);
    await db.insert(invoices).values(invoiceRow(biz.id));
    await expect(db.insert(invoices).values(invoiceRow(biz.id))).rejects.toThrow();
  });

  it("won't mark a payee verified without a first-contact check", async () => {
    const { biz, user } = await seed(db);
    await expect(db.insert(payees).values({ businessId: biz.id, seal: SEAL, status: "verified" })).rejects.toThrow();
    await db.insert(payees).values({
      businessId: biz.id,
      seal: SEAL,
      status: "verified",
      verificationMethod: "call-back to number on file",
      verifiedBy: user.id,
      verifiedAt: new Date(),
    });
  });

  it("keeps decision records append-only", async () => {
    const { biz } = await seed(db);
    const [d] = await db
      .insert(decisions)
      .values({ businessId: biz.id, kind: "hold", subject: FP, record: { rule: "new vendor" }, hash: `0x${"ef".repeat(32)}` })
      .returning();
    // drizzle wraps the database error; the trigger's message is the cause
    const cause = (e: unknown) => String((e as { cause?: Error }).cause?.message ?? e);
    const update = await db.update(decisions).set({ kind: "pay" }).where(eq(decisions.id, d!.id)).catch((e: unknown) => e);
    const remove = await db.delete(decisions).where(eq(decisions.id, d!.id)).catch((e: unknown) => e);
    expect(cause(update)).toMatch(/decisions is append-only: UPDATE/);
    expect(cause(remove)).toMatch(/decisions is append-only: DELETE/);
    expect(await db.select().from(decisions)).toHaveLength(1);
  });

  it("only accepts known Steward modes", async () => {
    await expect(db.insert(businesses).values({ name: "X", chainId: 1, stewardMode: "yolo" })).rejects.toThrow();
  });

  it("lets a wallet-first user exist without an email, and keeps wallets and Privy ids unique", async () => {
    const wallet = `0x${"12".repeat(20)}`;
    await db.insert(users).values({ wallet });
    await db.insert(users).values({ wallet: `0x${"34".repeat(20)}` }); // two users with no email: nulls don't collide
    await expect(db.insert(users).values({ wallet })).rejects.toThrow();
    await db.insert(users).values({ privyUserId: "did:privy:c-1", email: "a@b.example" });
    await expect(db.insert(users).values({ privyUserId: "did:privy:c-1" })).rejects.toThrow();
    await expect(db.insert(users).values({ email: "Mixed@Case.example" })).rejects.toThrow();
  });

  it("stores sessions by token hash only, one row per hash", async () => {
    const [u] = await db.insert(users).values({ wallet: `0x${"56".repeat(20)}` }).returning();
    const row = { userId: u!.id, tokenHash: "h".repeat(64), method: "privy" as const, expiresAt: new Date(Date.now() + 1000) };
    await db.insert(sessions).values(row);
    await expect(db.insert(sessions).values(row)).rejects.toThrow();
    await expect(db.insert(sessions).values({ ...row, tokenHash: "x", method: "password" as never })).rejects.toThrow();
  });

  it("stores only invitation hashes and forbids accepted-and-revoked links", async () => {
    const { biz, user } = await seed(db);
    const [invitation] = await db.insert(vendorInvitations).values({ businessId: biz.id, vendorName: "Northstar", contactNote: "known switchboard", tokenHash: "a".repeat(64), createdBy: user.id, expiresAt: new Date(Date.now() + 86_400_000) }).returning();
    expect(invitation!.tokenHash).toBe("a".repeat(64));
    await expect(db.update(vendorInvitations).set({ acceptedSeal: SEAL, acceptedAt: new Date(), revokedAt: new Date() }).where(eq(vendorInvitations.id, invitation!.id))).rejects.toThrow();
    await expect(db.insert(vendorInvitations).values({ businessId: biz.id, vendorName: "Bad", contactNote: "", tokenHash: "plaintext-token", createdBy: user.id, expiresAt: new Date(Date.now() + 1000) })).rejects.toThrow();
  });

  it("enforces the single open code request and bounded attempts", async () => {
    const { biz, user } = await seed(db);
    const base = { businessId: biz.id, seal: SEAL, method: "code" as const, status: "open" as const, raisedBy: user.id, codeHmac: "b".repeat(64), codeCiphertext: "iv:tag:ciphertext", expiresAt: new Date(Date.now() + 60_000) };
    await db.insert(vendorVerifications).values(base);
    await expect(db.insert(vendorVerifications).values(base)).rejects.toThrow();
    await expect(db.insert(vendorVerifications).values({ ...base, status: "cancelled", attempts: 6 })).rejects.toThrow();
    const [row] = await db.select().from(vendorVerifications);
    await expect(db.update(vendorVerifications).set({ secondBy: user.id }).where(eq(vendorVerifications.id, row!.id))).rejects.toThrow();
    await expect(db.insert(vendorVerifications).values({ businessId: biz.id, seal: `0x${"ef".repeat(20)}`, method: "code", raisedBy: user.id, expiresAt: new Date(Date.now() + 60_000) })).rejects.toThrow();
  });

  it("keeps a vendor's clients: a Vault or an email, lowercase, no duplicates per Seal, a payout address that is an address", async () => {
    await seed(db);
    const client = { seal: SEAL, name: "Acme" };
    await db.insert(vendorClients).values({ ...client, email: "ap@acme.example" });
    await expect(db.insert(vendorClients).values({ ...client, email: "ap@acme.example" })).rejects.toThrow();
    await expect(db.insert(vendorClients).values({ ...client, email: "AP@Acme.example" })).rejects.toThrow();
    await expect(db.insert(vendorClients).values(client)).rejects.toThrow();
    await db.insert(vendorClients).values({ ...client, vault: `0x${"12".repeat(20)}` });
    await expect(db.insert(vendorClients).values({ ...client, vault: `0x${"12".repeat(20)}` })).rejects.toThrow();
    await expect(db.insert(vendorClients).values({ ...client, vault: "0xABC" })).rejects.toThrow();
    await db.update(seals).set({ payoutAddress: `0x${"34".repeat(20)}` }).where(eq(seals.address, SEAL));
    await expect(db.update(seals).set({ payoutAddress: "nope" }).where(eq(seals.address, SEAL))).rejects.toThrow();
  });

  it("keeps unsigned bills unique per business and file, with bounded statuses", async () => {
    const { biz, user } = await seed(db);
    const bill = {
      businessId: biz.id,
      uploadedBy: user.id,
      fileName: "invoice.txt",
      fileSha256: `0x${"aa".repeat(32)}`,
      extraction: { vendorName: "Unknown" },
      assessment: { verdict: "unsigned" },
    } satisfies typeof unsignedBills.$inferInsert;
    await db.insert(unsignedBills).values(bill);
    await expect(db.insert(unsignedBills).values(bill)).rejects.toThrow();
    await expect(db.insert(unsignedBills).values({ ...bill, fileSha256: "bad" })).rejects.toThrow();
    await expect(db.insert(unsignedBills).values({ ...bill, fileSha256: `0x${"bb".repeat(32)}`, status: "paid" })).rejects.toThrow();
  });

  // N2 (05n): hold_source integrity
  it("rejects an invalid hold_source and hold_source set when status is not held", async () => {
    const { biz } = await seed(db);
    // Invalid hold_source value
    await expect(db.insert(invoices).values(invoiceRow(biz.id, { status: "held", holdSource: "agent" as never }))).rejects.toThrow();
    // hold_source without status=held
    await expect(db.insert(invoices).values(invoiceRow(biz.id, { status: "verified", holdSource: "steward" }))).rejects.toThrow();
    // Valid: held + steward
    await db.insert(invoices).values(invoiceRow(biz.id, { status: "held", holdSource: "steward" }));
    const [r] = await db.select().from(invoices);
    expect(r!.holdSource).toBe("steward");
  });

  // N2 (05n): delivery state constraints
  it("enforces delivery state and reason consistency", async () => {
    const { biz, user } = await seed(db);
    const base = { businessId: biz.id, fingerprint: FP, confirmedBy: user.id };
    // Invalid state
    await expect(db.insert(deliveries).values({ ...base, state: "pending" as never })).rejects.toThrow();
    // Reason on a confirmation is disallowed
    await expect(db.insert(deliveries).values({ ...base, state: "confirmed", reason: "broken" })).rejects.toThrow();
    // Rejection without reason is allowed (reason is optional on rejection in the schema; the server enforces non-empty)
    await db.insert(deliveries).values({ ...base, state: "rejected" });
    const [r] = await db.select().from(deliveries);
    expect(r!.state).toBe("rejected");
  });

  // N2 (05n): PO closed_at / closed_tx must agree
  it("requires closed_at and closed_tx to be set together on a PO", async () => {
    const { biz, user } = await seed(db);
    const po = {
      businessId: biz.id,
      poRef: `0x${"aa".repeat(32)}`,
      poNumber: "PO-001",
      seal: SEAL,
      budget: `0x${"00".repeat(32)}`,
      amount: 1_000_000n,
      kind: "one_off" as const,
      createdBy: user.id,
    };
    await db.insert(purchaseOrders).values(po);
    // closedAt without closedTx
    await expect(
      db.update(purchaseOrders).set({ closedAt: new Date() }).where(eq(purchaseOrders.poRef, po.poRef))
    ).rejects.toThrow();
    // closedTx without closedAt
    await expect(
      db.update(purchaseOrders).set({ closedTx: `0x${"bb".repeat(32)}` }).where(eq(purchaseOrders.poRef, po.poRef))
    ).rejects.toThrow();
    // Both together is fine
    await db.update(purchaseOrders).set({ closedAt: new Date(), closedTx: `0x${"bb".repeat(32)}` }).where(eq(purchaseOrders.poRef, po.poRef));
  });
});
