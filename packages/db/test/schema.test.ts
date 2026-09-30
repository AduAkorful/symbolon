import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { businesses, chainEvents, createTestDb, decisions, deliveries, earlyPayOffers, invoices, payees, purchaseOrders, queuedChanges, screenings, seals, sessions, stewardRuns, unsignedBills, users, vendorClients, vendorInvitations, vendorRequests, vendorVerifications } from "../src/index.js";

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

  // S6 (05o): steward_runs checks and partial unique index
  it("enforces steward_runs status/trigger checks and single active running lease", async () => {
    const { biz, user } = await seed(db);
    // Invalid trigger
    await expect(
      db.insert(stewardRuns).values({
        businessId: biz.id,
        trigger: "api" as never,
        mode: "shadow",
        status: "running",
      }),
    ).rejects.toThrow();

    // Invalid status
    await expect(
      db.insert(stewardRuns).values({
        businessId: biz.id,
        trigger: "manual",
        mode: "shadow",
        status: "pending" as never,
      }),
    ).rejects.toThrow();

    // Valid running run
    const [run1] = await db
      .insert(stewardRuns)
      .values({
        businessId: biz.id,
        trigger: "manual",
        mode: "shadow",
        status: "running",
        startedBy: user.id,
      })
      .returning();
    expect(run1!.status).toBe("running");

    // Second simultaneous running run for the same business fails unique partial index
    await expect(
      db.insert(stewardRuns).values({
        businessId: biz.id,
        trigger: "schedule",
        mode: "shadow",
        status: "running",
      }),
    ).rejects.toThrow();

    // Mark first as done
    await db.update(stewardRuns).set({ status: "done", finishedAt: new Date() }).where(eq(stewardRuns.id, run1!.id));

    // Now a new running run can be inserted
    const [run2] = await db
      .insert(stewardRuns)
      .values({
        businessId: biz.id,
        trigger: "schedule",
        mode: "shadow",
        status: "running",
      })
      .returning();
    expect(run2!.status).toBe("running");
  });

  // S9 (05o): businesses vault_block check
  it("enforces non-negative vault_block on businesses", async () => {
    const [b] = await db.insert(businesses).values({ name: "BlockTest", chainId: 5_042_002, vaultBlock: 100n }).returning();
    expect(b!.vaultBlock).toBe(100n);

    await expect(
      db.insert(businesses).values({ name: "NegBlock", chainId: 5_042_002, vaultBlock: -1n }),
    ).rejects.toThrow();
  });

  // K1 (05s Part A): screenings table checks
  it("enforces risk range, result check, and address formats on screenings", async () => {
    const { biz, user } = await seed(db);
    const PAYOUT = `0x${"12".repeat(20)}`;

    // Valid insert
    const [row] = await db
      .insert(screenings)
      .values({
        businessId: biz.id,
        seal: SEAL,
        address: PAYOUT,
        risk: 0,
        result: "APPROVED",
        ruleName: "pass-rule",
        actions: ["APPROVE"],
        categories: ["CLEAN"],
        provider: "circle-compliance-engine",
        screenedAt: new Date(),
        createdBy: user.id,
      })
      .returning();
    expect(row!.result).toBe("APPROVED");
    expect(row!.risk).toBe(0);
    expect(row!.actions).toEqual(["APPROVE"]);
    expect(row!.categories).toEqual(["CLEAN"]);

    // Invalid risk (< 0 or > 3)
    await expect(
      db.insert(screenings).values({
        businessId: biz.id,
        seal: SEAL,
        address: PAYOUT,
        risk: 4,
        result: "APPROVED",
        provider: "circle",
        screenedAt: new Date(),
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(screenings).values({
        businessId: biz.id,
        seal: SEAL,
        address: PAYOUT,
        risk: -1,
        result: "APPROVED",
        provider: "circle",
        screenedAt: new Date(),
      }),
    ).rejects.toThrow();

    // Invalid result (not APPROVED or DENIED)
    await expect(
      db.insert(screenings).values({
        businessId: biz.id,
        seal: SEAL,
        address: PAYOUT,
        risk: 1,
        result: "UNKNOWN",
        provider: "circle",
        screenedAt: new Date(),
      }),
    ).rejects.toThrow();

    // Invalid seal/address format
    await expect(
      db.insert(screenings).values({
        businessId: biz.id,
        seal: "not-an-address",
        address: PAYOUT,
        risk: 0,
        result: "APPROVED",
        provider: "circle",
        screenedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("handles early pay offer statuses and vendor requests multi-business signatures", async () => {
    const { biz } = await seed(db);
    const [biz2] = await db.insert(businesses).values({ name: "Beta", chainId: 5_042_002 }).returning();

    // earlyPayOffers allows withdrawn status
    const [offer] = await db
      .insert(earlyPayOffers)
      .values({
        fingerprint: FP,
        discountBps: 150,
        validUntil: new Date(Date.now() + 86400000),
        status: "withdrawn",
      })
      .returning();
    expect(offer!.status).toBe("withdrawn");

    // earlyPayOffers rejects invalid status
    await expect(
      db.insert(earlyPayOffers).values({
        fingerprint: FP,
        discountBps: 150,
        validUntil: new Date(Date.now() + 86400000),
        status: "invalid_status",
      }),
    ).rejects.toThrow();

    // vendorRequests allows same signature across distinct businesses
    const sig = "0x" + "aa".repeat(65);
    const [r1] = await db
      .insert(vendorRequests)
      .values({
        businessId: biz.id,
        seal: SEAL,
        kind: "payout_change",
        message: { newPayout: SEAL },
        signature: sig,
        status: "pending",
      })
      .returning();
    expect(r1!.id).toBeDefined();

    const [r2] = await db
      .insert(vendorRequests)
      .values({
        businessId: biz2!.id,
        seal: SEAL,
        kind: "payout_change",
        message: { newPayout: SEAL },
        signature: sig,
        status: "cancelled",
      })
      .returning();
    expect(r2!.id).toBeDefined();
    expect(r2!.status).toBe("cancelled");

    // vendorRequests rejects duplicate signature for SAME business
    await expect(
      db.insert(vendorRequests).values({
        businessId: biz.id,
        seal: SEAL,
        kind: "payout_change",
        message: { newPayout: SEAL },
        signature: sig,
      }),
    ).rejects.toThrow();
  });

  it("enforces businesses.buffer_days bounds (1..90 or null)", async () => {
    // Allows null
    const [b1] = await db.insert(businesses).values({ name: "NullBuffer", chainId: 5_042_002, bufferDays: null }).returning();
    expect(b1!.bufferDays).toBeNull();

    // Allows 1 and 90
    const [b2] = await db.insert(businesses).values({ name: "MinBuffer", chainId: 5_042_002, bufferDays: 1 }).returning();
    expect(b2!.bufferDays).toBe(1);

    const [b3] = await db.insert(businesses).values({ name: "MaxBuffer", chainId: 5_042_002, bufferDays: 90 }).returning();
    expect(b3!.bufferDays).toBe(90);

    // Rejects 0
    await expect(
      db.insert(businesses).values({ name: "ZeroBuffer", chainId: 5_042_002, bufferDays: 0 }),
    ).rejects.toThrow();

    // Rejects 91
    await expect(
      db.insert(businesses).values({ name: "HighBuffer", chainId: 5_042_002, bufferDays: 91 }),
    ).rejects.toThrow();
  });

  it("enforces queued_changes format, status, and per-business uniqueness", async () => {
    const { user, biz } = await seed(db);
    const [biz2] = await db.insert(businesses).values({ name: "Beta", chainId: 5_042_002 }).returning();

    const changeId = `0x${"11".repeat(32)}`;
    const selector = "0x12345678";
    const eta = new Date(Date.now() + 86400000);

    // Valid insertion
    const [qc] = await db
      .insert(queuedChanges)
      .values({
        businessId: biz.id,
        kind: "set_policy",
        changeId,
        selector,
        calldata: "0x12345678abcdef",
        summary: { what: "update policy" },
        createdBy: user.id,
        eta,
        status: "queued",
      })
      .returning();
    expect(qc!.id).toBeDefined();
    expect(qc!.status).toBe("queued");

    // Rejects duplicate (businessId, changeId)
    await expect(
      db.insert(queuedChanges).values({
        businessId: biz.id,
        kind: "set_policy",
        changeId,
        selector,
        summary: { what: "another update" },
        eta,
      }),
    ).rejects.toThrow();

    // Allows same changeId for a different business
    const [qc2] = await db
      .insert(queuedChanges)
      .values({
        businessId: biz2!.id,
        kind: "set_policy",
        changeId,
        selector,
        summary: { what: "beta update" },
        eta,
      })
      .returning();
    expect(qc2!.id).toBeDefined();

    // Rejects invalid selector format
    await expect(
      db.insert(queuedChanges).values({
        businessId: biz.id,
        kind: "set_policy",
        changeId: `0x${"22".repeat(32)}`,
        selector: "not-a-selector",
        summary: {},
        eta,
      }),
    ).rejects.toThrow();

    // Rejects invalid changeId format
    await expect(
      db.insert(queuedChanges).values({
        businessId: biz.id,
        kind: "set_policy",
        changeId: "0xbad",
        selector,
        summary: {},
        eta,
      }),
    ).rejects.toThrow();
  });

  it("stores chain_events with optional block_time", async () => {
    const blockTime = new Date("2026-09-30T12:00:00Z");
    const txHash = `0x${"aa".repeat(32)}`;
    const address = `0x${"bb".repeat(20)}`;

    await db.insert(chainEvents).values({
      chainId: 5_042_002,
      txHash,
      logIndex: 0,
      blockNumber: 12345n,
      blockTime,
      address,
      eventName: "Paid",
      args: { amount: "1000" },
    });

    const [row] = await db.select().from(chainEvents);
    expect(row).toBeDefined();
    expect(row!.blockTime?.toISOString()).toBe(blockTime.toISOString());
    expect(row!.eventName).toBe("Paid");
  });
});


