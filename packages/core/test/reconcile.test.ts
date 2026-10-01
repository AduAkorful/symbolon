import { keccak256, stringToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { SymbolonContracts } from "@symbolon/chain";
import { businesses, createTestDb, decisions, invoices } from "@symbolon/db";

import { reconcile, shadowAgreement, humanResponseAgreement } from "../src/index.js";

const fp = (s: string) => keccak256(stringToBytes(s)) as Hex;
const row = (businessId: string, f: Hex, o: Partial<typeof invoices.$inferInsert> = {}) => ({
  fingerprint: f,
  chainId: 5_042_002,
  ledger: `0x${"11".repeat(20)}`,
  seal: `0x${"22".repeat(20)}`,
  businessId,
  payerRef: `0x${"00".repeat(32)}`,
  invoiceNumber: f.slice(0, 8),
  token: `0x${"36".repeat(20)}`,
  total: 100n,
  dueDate: new Date(),
  envelope: "{}",
  source: "link",
  ...o,
});

function ledger(states: Record<string, { credited: bigint; total: bigint; cancelled?: boolean }>) {
  const s = (f: Hex) => states[f] ?? { credited: 0n, total: 100n };
  return {
    ledger: {
      read: {
        status: async ([f]: [Hex]) => ({ seal: `0x${"22".repeat(20)}`, total: s(f).total, credited: s(f).credited, cancelled: s(f).cancelled ?? false, seen: s(f).credited > 0n || Boolean(s(f).cancelled) }),
        remaining: async ([f]: [Hex]) => (s(f).cancelled ? 0n : s(f).total - s(f).credited),
      },
    },
  } as unknown as SymbolonContracts;
}

describe("reconciliation (Flow 11)", () => {
  it("flags every difference from the ledger to the last unit", async () => {
    const db = await createTestDb();
    const [b] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002 }).returning();
    await db.insert(invoices).values([
      row(b!.id, fp("ok"), { status: "paid", credited: 100n }),
      row(b!.id, fp("short"), { status: "paid", credited: 100n }),
      row(b!.id, fp("unsynced"), { status: "scheduled" }),
    ]);
    const m = await reconcile(db, ledger({ [fp("ok")]: { credited: 100n, total: 100n }, [fp("short")]: { credited: 99n, total: 100n }, [fp("unsynced")]: { credited: 100n, total: 100n } }), b!.id);
    expect(m).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fingerprint: fp("short"), field: "credited", database: "100", ledger: "99" }),
        expect.objectContaining({ fingerprint: fp("short"), field: "status", ledger: "partially_paid" }),
        expect.objectContaining({ fingerprint: fp("unsynced"), field: "status", database: "scheduled", ledger: "paid" }),
      ]),
    );
    expect(m.some((x) => x.fingerprint === fp("ok"))).toBe(false);
  });
});

describe("shadow agreement (Flow 13)", () => {
  it("compares the Steward's latest shadow call with what actually happened", async () => {
    const db = await createTestDb();
    const [b] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002 }).returning();
    await db.insert(invoices).values([
      row(b!.id, fp("a"), { status: "paid", credited: 100n }),
      row(b!.id, fp("b"), { status: "rejected" }),
      row(b!.id, fp("c"), { status: "paid", credited: 100n }),
      row(b!.id, fp("d"), { status: "scheduled" }),
    ]);
    const dec = (f: Hex, kind: string, n: number) => ({ businessId: b!.id, kind, subject: f, record: { mode: "shadow", kind }, hash: keccak256(stringToBytes(`${f}${n}`)) });
    await db.insert(decisions).values([dec(fp("a"), "schedule", 1), dec(fp("b"), "hold", 2), dec(fp("c"), "hold", 3), dec(fp("d"), "pay", 4)]);
    const r = await shadowAgreement(db, b!.id);
    expect(r).toMatchObject({ compared: 3, agreed: 2, rateBps: 6_666 });
    expect(r.disagreements).toEqual([{ fingerprint: fp("c"), steward: "hold", actual: "paid" }]);
  });
});


describe("linked human responses", () => {
  it("counts latest eligible response once and ignores orphan and unrelated kinds", async () => {
    const db = await createTestDb();
    const [b] = await db.insert(businesses).values({name:"Metric",chainId:5042002}).returning();
    const rec = fp("rec");
    await db.insert(decisions).values([
      {businessId:b!.id,kind:"pay",subject:fp("invoice"),hash:rec,record:{outcome:"request_approval"},createdAt:new Date("2026-10-01T00:00:00Z")},
      {businessId:b!.id,kind:"approval_granted",subject:fp("invoice"),hash:fp("first"),record:{inputs:{recommendation:rec}},createdAt:new Date("2026-10-01T01:00:00Z")},
      {businessId:b!.id,kind:"approval_rejected",subject:fp("invoice"),hash:fp("last"),record:{inputs:{recommendation:rec}},createdAt:new Date("2026-10-01T02:00:00Z")},
      {businessId:b!.id,kind:"approval_granted",subject:fp("invoice"),hash:fp("orphan"),record:{inputs:{recommendation:fp("absent")}}},
    ]);
    expect(await humanResponseAgreement(db,b!.id)).toMatchObject({total:1,agreed:0});
  });
});
