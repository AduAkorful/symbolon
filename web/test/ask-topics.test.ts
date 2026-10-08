import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const loaders = vi.hoisted(() => ({
  listBudgets: vi.fn(),
  listOrders: vi.fn(),
  loadPolicyView: vi.fn(),
}));
vi.mock("@/lib/server/budgets", () => ({ listBudgets: loaders.listBudgets }));
vi.mock("@/lib/server/orders", () => ({ listOrders: loaders.listOrders }));
vi.mock("@/lib/server/policy-edit", () => ({ loadPolicyView: loaders.loadPolicyView }));

import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  createTestDb, businesses, decisions, earlyPayOffers, invoices, members, payees, queuedChanges, screenings, seals, users, type Database,
} from "@symbolon/db";
import { executeIntent, listIntentDescriptors } from "@/lib/server/intents/registry";
import { resolveVendors } from "@/lib/server/intents/resolve";
import type { IntentContext } from "@/lib/server/intents/types";

const deployment = getDeployment(arcTestnet.id);
const NOW = new Date("2026-10-07T12:00:00Z");
const ANA = `0x${"aa".repeat(20)}`;
const ANAS = `0x${"ab".repeat(20)}`; // a second vendor whose name starts like the first
const OTHER_SEAL = `0x${"cc".repeat(20)}`;
const fp = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}`;

describe("Ask topics (plan 05y Part C)", () => {
  let db: Database;
  let biz: string;
  let other: string;
  let owner: string;
  let ctx: IntentContext;

  async function vendor(seal: string, displayName: string, handle: string, status: "verified" | "pending_verification" | "blocked", forBiz = biz) {
    const [u] = await db.insert(users).values({ email: `${handle}@v.example` }).returning();
    await db.insert(seals).values({ address: seal, userId: u!.id, handle, displayName }).onConflictDoNothing();
    await db.insert(payees).values({ businessId: forBiz, seal, status, ...(status === "verified" ? { verificationMethod: "invitation", verifiedAt: new Date("2026-09-20T00:00:00Z") } : {}) });
  }
  async function invoice(n: number, seal: string, over: Partial<typeof invoices.$inferInsert> = {}, forBiz = biz) {
    await db.insert(invoices).values({
      fingerprint: fp(n), chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger, seal, businessId: forBiz,
      payerRef: fp(99), invoiceNumber: `INV-${n}`, token: deployment.tokens.usdc, total: 2_200_000_000n, credited: 0n,
      dueDate: new Date("2026-10-12T00:00:00Z"), envelope: "{}", source: "link", status: "verified", ...over,
    });
  }

  beforeEach(async () => {
    Object.values(loaders).forEach((f) => f.mockReset());
    db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    owner = u!.id;
    const [b1] = await db.insert(businesses).values({ name: "Acme", chainId: arcTestnet.id }).returning();
    const [b2] = await db.insert(businesses).values({ name: "Other", chainId: arcTestnet.id }).returning();
    biz = b1!.id;
    other = b2!.id;
    await db.insert(members).values({ businessId: biz, userId: owner, role: "owner" });
    ctx = { db, businessId: biz, client: {} as never, deployment, now: NOW, userId: owner };
  });

  it("registers all eighteen intents with distinct, strict-safe descriptors", () => {
    const names = listIntentDescriptors().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["vendor_summary", "open_offers", "budget_remaining", "treasury_moves", "open_orders", "pending_changes", "policy_summary", "screening_status"]));
    expect(names).toHaveLength(18);
  });

  describe("vendor resolution", () => {
    it("finds a vendor by name, handle or address, best match first, and only this business's", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await vendor(ANAS, "Anastasia Ltd", "anastasia", "pending_verification");
      await vendor(OTHER_SEAL, "Studio Ana Two", "ana2", "verified", other);
      expect((await resolveVendors(ctx, "studio ana")).map((v) => v.seal)).toEqual([ANA]);
      expect((await resolveVendors(ctx, "studioana")).map((v) => v.seal)).toEqual([ANA]);
      expect((await resolveVendors(ctx, ANA.toUpperCase().replace("0X", "0x"))).map((v) => v.seal)).toEqual([ANA]);
      expect((await resolveVendors(ctx, "ana")).map((v) => v.name).sort()).toEqual(["Anastasia Ltd", "Studio Ana"].sort());
      expect(await resolveVendors(ctx, "Studio Ana Two")).toEqual([]);
      expect(await resolveVendors(ctx, "   ")).toEqual([]);
    });
  });

  describe("vendor_summary", () => {
    it("says where one vendor stands from the business's own records", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await invoice(1, ANA, { status: "paid", credited: 2_200_000_000n });
      await invoice(2, ANA, { status: "scheduled", total: 1_000_000_000n });
      const r = await executeIntent(ctx, "vendor_summary", { vendor: "Studio Ana" });
      expect(r.text).toBe("Studio Ana is verified on 20 Sep 2026. 1 invoice paid, 1 open for $1,000.00, next due 12 Oct 2026.");
      expect(r.links[0]).toEqual(["Studio Ana", `/business/vendors/${ANA}`]);
      expect(r.params).toEqual({ vendor: "Studio Ana" });
    });

    it("asks which vendor when none is named, or when several match, and says so when none does", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await vendor(ANAS, "Anastasia Ltd", "anastasia", "pending_verification");
      expect((await executeIntent(ctx, "vendor_summary", {})).text).toContain("Which vendor?");
      const several = await executeIntent(ctx, "vendor_summary", { vendor: "ana" });
      expect(several.text).toContain("Several vendors match");
      expect(several.links).toHaveLength(2);
      expect((await executeIntent(ctx, "vendor_summary", { vendor: "Nobody Ltd" })).text).toContain("couldn't find a vendor");
    });

    it("never shows another business's vendor or invoices", async () => {
      await vendor(OTHER_SEAL, "Hidden Ltd", "hidden", "verified", other);
      await invoice(5, OTHER_SEAL, {}, other);
      expect((await executeIntent(ctx, "vendor_summary", { vendor: "Hidden Ltd" })).text).toContain("couldn't find a vendor");
    });
  });

  describe("why_decision with a vendor name", () => {
    it("takes the vendor's latest invoice", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await invoice(1, ANA, { status: "held" });
      await db.insert(decisions).values({ businessId: biz, kind: "hold", subject: fp(1), hash: fp(77), record: { version: 1, kind: "hold", rule: "No delivery confirmed", outcome: "held" } });
      const r = await executeIntent(ctx, "why_decision", { invoice: "Studio Ana's" });
      expect(r.text).toContain("Held: No delivery confirmed");
    });
  });

  describe("open_offers", () => {
    it("lists open and countered offers that haven't expired, for this business only", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await invoice(1, ANA);
      await invoice(2, ANA);
      await db.insert(earlyPayOffers).values([
        { fingerprint: fp(1), discountBps: 250, validUntil: new Date("2026-10-20T00:00:00Z"), status: "open" },
        { fingerprint: fp(2), discountBps: 100, validUntil: new Date("2026-10-01T00:00:00Z"), status: "open" },
      ]);
      const r = await executeIntent(ctx, "open_offers", {});
      expect(r.text).toBe("1 Early Pay offer is open: Studio Ana, invoice INV-1, 2.5% off, valid until 20 Oct 2026.");
      expect(r.text).not.toMatch(/earn|yield|return/i);
      const none = await executeIntent({ ...ctx, businessId: other }, "open_offers", {});
      expect(none.text).toBe("No Early Pay offers are open right now.");
    });
  });

  describe("budget_remaining", () => {
    it("reads budgets and filters by name", async () => {
      loaders.listBudgets.mockResolvedValue({ budgets: [
        { name: "Operating", remaining: "$3,200.00", cap: "$5,000.00", periodLengthLabel: "30-day period" },
        { name: "Marketing", remaining: "$1,800.00", cap: "$2,000.00", periodLengthLabel: "30-day period" },
      ] });
      expect((await executeIntent(ctx, "budget_remaining", {})).text).toBe("Operating: $3,200.00 left of $5,000.00 (30-day period); Marketing: $1,800.00 left of $2,000.00 (30-day period).");
      const one = await executeIntent(ctx, "budget_remaining", { budget: "market" });
      expect(one.text).toBe("Marketing: $1,800.00 left of $2,000.00 (30-day period).");
      expect((await executeIntent(ctx, "budget_remaining", { budget: "travel" })).text).toContain("couldn't find a budget");
    });

    it("says it can't confirm when the chain read fails, and does not answer from anything else", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      loaders.listBudgets.mockRejectedValue(new Error("rpc down"));
      const r = await executeIntent(ctx, "budget_remaining", {});
      log.mockRestore();
      expect(r.text).toBe("Can't confirm the budgets right now. Try again shortly.");
    });
  });

  describe("treasury_moves", () => {
    it("lists treasury decisions in the window and none outside it", async () => {
      await db.insert(decisions).values([
        { businessId: biz, kind: "withdrawn", subject: "treasury:withdraw", hash: fp(10), record: { version: 1, kind: "withdrawn", rule: "Owner withdrawal", outcome: "withdrawn", inputs: {} }, createdAt: new Date("2026-10-05T00:00:00Z") },
        { businessId: biz, kind: "pay", subject: fp(1), hash: fp(11), record: { version: 1, kind: "pay", outcome: "paid" }, createdAt: new Date("2026-10-05T00:00:00Z") },
        { businessId: biz, kind: "sweep", subject: "reserve", hash: fp(12), record: { version: 1, kind: "sweep", outcome: "swept" }, createdAt: new Date("2026-06-01T00:00:00Z") },
      ]);
      const r = await executeIntent(ctx, "treasury_moves", { days: 30 });
      expect(r.text).toMatch(/^1 treasury move in the last 30 days\./);
      expect(r.text).toContain("5 Oct 2026");
      expect((await executeIntent(ctx, "treasury_moves", { days: 1 })).text).toContain("No withdrawals, conversions or reserve moves");
      expect((await executeIntent(ctx, "treasury_moves", { days: 9999 })).text).toContain("last 90 days");
      expect((await executeIntent(ctx, "treasury_moves", {})).text).toMatch(/last 30 days/);
    });
  });

  describe("open_orders", () => {
    const order = (over: Record<string, unknown>) => ({ poNumber: "PO-1042", seal: ANA, vendorName: "Studio Ana", closedAt: null, live: { ok: true, remaining: "600.000000" }, ...over });

    it("lists open orders with what is left, and says when the remaining can't be confirmed", async () => {
      loaders.listOrders.mockResolvedValue([order({}), order({ poNumber: "PO-7", live: { ok: false } }), order({ poNumber: "PO-OLD", closedAt: new Date() })]);
      const r = await executeIntent(ctx, "open_orders", {});
      expect(r.text).toBe("2 open orders. PO-1042 (Studio Ana): 600.000000 left; PO-7 (Studio Ana): remaining can't be confirmed right now.");
    });

    it("filters to one vendor", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      loaders.listOrders.mockResolvedValue([order({}), order({ poNumber: "PO-9", seal: OTHER_SEAL, vendorName: "Else" })]);
      const r = await executeIntent(ctx, "open_orders", { vendor: "Studio Ana" });
      expect(r.text).toBe("For Studio Ana: 1 open order. PO-1042 (Studio Ana): 600.000000 left.");
    });
  });

  describe("pending_changes", () => {
    it("lists waiting changes with when they can be applied, for this business only", async () => {
      await db.insert(queuedChanges).values([
        { businessId: biz, kind: "set_policy", changeId: fp(30), selector: "0x12345678", summary: { title: "Raise the per-invoice cap" }, eta: new Date("2026-10-09T14:00:00Z"), status: "queued" },
        { businessId: biz, kind: "set_policy", changeId: fp(31), selector: "0x12345678", summary: { title: "Old one" }, eta: new Date("2026-10-01T00:00:00Z"), status: "applied" },
        { businessId: other, kind: "set_policy", changeId: fp(32), selector: "0x12345678", summary: { title: "Not ours" }, eta: new Date("2026-10-09T14:00:00Z"), status: "queued" },
      ]);
      const r = await executeIntent(ctx, "pending_changes", {});
      expect(r.text).toBe("1 change is waiting: Raise the per-invoice cap, can be applied from 9 Oct, 14:00 UTC.");
      expect((await executeIntent({ ...ctx, businessId: other }, "pending_changes", {})).text).toContain("Not ours");
      await db.delete(queuedChanges);
      expect((await executeIntent(ctx, "pending_changes", {})).text).toBe("No changes are waiting.");
    });
  });

  describe("policy_summary", () => {
    it("answers in the policy's own generated words", async () => {
      loaders.loadPolicyView.mockResolvedValue({ lines: ["Payments up to $500.00 go out on their own.", "Anything above $2,000.00 needs the owner."] });
      const r = await executeIntent(ctx, "policy_summary", {});
      expect(r.text).toBe("Payments up to $500.00 go out on their own. Anything above $2,000.00 needs the owner.");
    });

    it("can't confirm when the read fails", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      loaders.loadPolicyView.mockRejectedValue(new Error("rpc down"));
      expect((await executeIntent(ctx, "policy_summary", {})).text).toBe("Can't confirm the policy right now. Try again shortly.");
      log.mockRestore();
    });
  });

  describe("screening_status", () => {
    it("counts screened and unscreened payees and gives the latest risk per payee", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await vendor(ANAS, "Anastasia Ltd", "anastasia", "verified");
      await db.insert(screenings).values([
        { businessId: biz, seal: ANA, address: ANA, risk: 2, result: "DENIED", provider: "circle", screenedAt: new Date("2026-09-01T00:00:00Z") },
        { businessId: biz, seal: ANA, address: ANA, risk: 0, result: "APPROVED", provider: "circle", screenedAt: new Date("2026-10-01T00:00:00Z") },
      ]);
      const r = await executeIntent(ctx, "screening_status", {});
      expect(r.text).toBe("1 of 2 payees screened, 1 not screened yet. Studio Ana: low risk on 1 Oct 2026.");
      expect(r.text).not.toMatch(/clean|safe/i);
      expect((await executeIntent(ctx, "screening_status", { vendor: "Anastasia" })).text).toBe("For Anastasia Ltd: 0 of 1 payee screened, 1 not screened yet.");
    });
  });

  describe("read-only by construction (05u N13)", () => {
    it("none of the new intents write", async () => {
      await vendor(ANA, "Studio Ana", "studioana", "verified");
      await invoice(1, ANA);
      loaders.listBudgets.mockResolvedValue({ budgets: [] });
      loaders.listOrders.mockResolvedValue([]);
      loaders.loadPolicyView.mockResolvedValue({ lines: ["x"] });
      const refuse = () => { throw new Error("a write was attempted"); };
      const guarded = new Proxy(db, { get: (t, k, r) => (k === "insert" || k === "update" || k === "delete" || k === "transaction" ? refuse : Reflect.get(t, k, r)) }) as Database;
      const g = { ...ctx, db: guarded };
      for (const [name, params] of [
        ["vendor_summary", { vendor: "Studio Ana" }], ["open_offers", {}], ["budget_remaining", {}], ["treasury_moves", { days: 30 }],
        ["open_orders", {}], ["pending_changes", {}], ["policy_summary", {}], ["screening_status", {}], ["why_decision", { invoice: "Studio Ana" }],
      ] as const) {
        await expect(executeIntent(g, name, params)).resolves.toBeTruthy();
      }
    });
  });
});
