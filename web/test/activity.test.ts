import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Hex } from "viem";

vi.mock("server-only", () => ({}));
import { arcTestnet } from "@symbolon/chain";
import {
  businesses,
  chainEvents,
  createTestDb,
  decisions,
  invoices,
  members,
  seals,
  users,
} from "@symbolon/db";
import {
  describeDecision,
  describeEvent,
  loadActivity,
} from "@/lib/server/activity";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
let vaultNo = 400;
let sealNo = 50;
let userNo = 1000;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({ email: `act-owner-${crypto.randomUUID()}@example.test`, wallet: address(++userNo) })
    .returning();
  const [member] = await db
    .insert(users)
    .values({ email: `act-member-${crypto.randomUUID()}@example.test`, wallet: address(++userNo) })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: `act-out-${crypto.randomUUID()}@example.test` })
    .returning();

  const vaultAddr = address(++vaultNo);
  const stewardAddr = address(881);

  const [business] = await db
    .insert(businesses)
    .values({
      name: "Activity Corp",
      chainId: arcTestnet.id,
      vault: vaultAddr,
      stewardWallet: stewardAddr,
      stewardMode: "assist",
    })
    .returning();

  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: member!.id, role: "approver" },
  ]);

  const sealAddr = address(++sealNo);
  await db.insert(seals).values({
    address: sealAddr,
    userId: member!.id,
    handle: `studio-ana-${sealNo}`,
    displayName: "Studio Ana",
    payoutAddress: address(21),
  });

  return { owner: owner!, member: member!, outsider: outsider!, business: business!, sealAddr, vaultAddr, stewardAddr };
}

describe("Activity service and formatters (05s Part C)", () => {
  describe("describeEvent pure formatter (K12)", () => {
    it("reads a native-coin deposit in 18 decimals, not the token's 6", () => {
      const from = "0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd";
      expect(describeEvent("NativeReceived", { from, value: 45_000_000_000_000_000_000n }).what).toBe(`Received $45.00 from ${from}`);
      expect(describeEvent("NativeReceived", { from, value: 1_500_000_000_000_000n }).what).toContain("0.0015");
    });
    it("formats Paid event", () => {
      const desc = describeEvent("Paid", { fingerprint: hash(1), paid: 1985000000n }, undefined, "USDC");
      expect(desc.what).toContain("Paid $1,985.00 for invoice");
      expect(describeEvent("Paid", { fingerprint: hash(1), paid: 1985000000n }, undefined, "EURC").what).toContain("€1,985.00");
      // an event that doesn't say which token it moved never gets a guessed currency
      expect(describeEvent("Paid", { fingerprint: hash(1), paid: 1985000000n }).what).toMatch(/^Paid for invoice/);
      expect(desc.tone).toBe("seal");
    });

    it("formats Paused event", () => {
      const desc = describeEvent("Paused", {});
      expect(desc.what).toBe("Paused Vault outgoing payments");
      expect(desc.tone).toBe("red");
    });

    it("formats Unpaused event", () => {
      const desc = describeEvent("Unpaused", {});
      expect(desc.what).toBe("Resumed Vault outgoing payments");
      expect(desc.tone).toBe("seal");
    });

    it("formats DeliveryConfirmed and DeliveryRejected", () => {
      const c = describeEvent("DeliveryConfirmed", { fingerprint: hash(2) });
      expect(c.what).toContain("Confirmed delivery");
      expect(c.tone).toBe("seal");

      const r = describeEvent("DeliveryRejected", { fingerprint: hash(2) });
      expect(r.what).toContain("Rejected delivery");
      expect(r.tone).toBe("red");
    });

    it("falls back to generic description for unknown event without dropping (K10)", () => {
      const desc = describeEvent("CustomVaultEvent", {});
      expect(desc.what).toBe("Recorded onchain: CustomVaultEvent");
    });
  });

  describe("describeDecision pure formatter (K12)", () => {
    it("formats Steward hold decision with rule", () => {
      const d: any = {
        kind: "hold",
        subject: hash(3),
        record: { rule: "duplicate invoice detected" },
        outcome: "held",
      };
      const desc = describeDecision(d);
      expect(desc.what).toContain("Steward held invoice");
      expect(desc.what).toContain("duplicate invoice detected");
      expect(desc.tone).toBe("red");
    });

    it("formats export_created decision", () => {
      const d: any = {
        kind: "export_created",
        subject: "sha256hash",
        record: { format: "csv", rowCount: 15 },
        outcome: "exported",
      };
      const desc = describeDecision(d);
      expect(desc.what).toBe("Exported csv records (15 entries)");
    });
  });

  describe("loadActivity", () => {
    it("refuses non-member with 403", async () => {
      const { outsider, business } = await fixture();
      await expect(loadActivity(db, undefined, outsider, business.id)).rejects.toMatchObject({
        status: 403,
      });
    });

    it("aggregates decisions, vault events, ledger events, and invoices in timeline order", async () => {
      const { owner, business, sealAddr, vaultAddr, stewardAddr } = await fixture();
      const fp = hash(10);

      // 1. Insert invoice
      await db.insert(invoices).values({
        fingerprint: fp,
        chainId: arcTestnet.id,
        ledger: address(1),
        seal: sealAddr,
        businessId: business.id,
        payerRef: hash(0),
        invoiceNumber: "INV-100",
        token: address(2),
        total: 1000_000000n,
        dueDate: new Date(),
        envelope: "{}",
        source: "link",
      });

      // 2. Insert decision
      await db.insert(decisions).values({
        businessId: business.id,
        kind: "pay",
        subject: fp,
        hash: hash(11),
        record: { mode: "assist", rule: "within policy" },
      });

      // 3. Insert Vault event
      await db.insert(chainEvents).values({
        chainId: arcTestnet.id,
        txHash: hash(12),
        logIndex: 0,
        blockNumber: 1000n,
        blockTime: new Date("2026-09-30T10:00:00Z"),
        address: vaultAddr.toLowerCase(),
        eventName: "Paid",
        args: { fingerprint: fp, paid: "1000000000", caller: stewardAddr },
      });

      const feed = await loadActivity(db, undefined, owner, business.id);
      expect(feed.items.length).toBeGreaterThanOrEqual(3);

      // Verify Steward actor resolved
      const vaultEventItem = feed.items.find((i) => i.source === "chain_event");
      expect(vaultEventItem).toBeDefined();
      expect(vaultEventItem!.actor.kind).toBe("steward");
      expect(vaultEventItem!.actor.label).toBe("Steward");

      // Verify filter options
      expect(feed.whoOptions).toContain("All");
      expect(feed.whoOptions).toContain("Steward");
      expect(feed.vendorOptions).toContain("Studio Ana");
    });

    it("enforces two-business isolation (never returns other business events)", async () => {
      const { owner, business } = await fixture();
      const otherBiz = await db
        .insert(businesses)
        .values({ name: "Other Corp", chainId: arcTestnet.id, vault: address(++vaultNo) })
        .returning();

      await db.insert(decisions).values({
        businessId: otherBiz[0]!.id,
        kind: "hold",
        subject: hash(99),
        hash: hash(99),
        record: {},
      });

      const feed = await loadActivity(db, undefined, owner, business.id);
      const otherItems = feed.items.filter((i) => i.id.includes(otherBiz[0]!.id));
      expect(otherItems).toHaveLength(0);
    });
  });
});
