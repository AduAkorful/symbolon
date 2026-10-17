import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { arcTestnet } from "@symbolon/chain";
import { businesses, createTestDb, members, notifications, users } from "@symbolon/db";
import { notifyBusiness } from "@symbolon/core";
import { appendAppDecision } from "@/lib/server/app-decisions";
import { describeNotification } from "@/lib/server/notification-text";

// QA REL4-6, LEND-3 and UI-24: the bell notices fire and read as people expect

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

let n = 5000;
const addr = () => "0x" + (n++).toString(16).padStart(40, "0");

async function soleOwnerBusiness() {
  const [owner] = await db.insert(users).values({ email: `owner-${crypto.randomUUID()}@example.test`, wallet: addr() }).returning();
  const [biz] = await db.insert(businesses).values({ name: "Kente Logistics Ltd", chainId: arcTestnet.id, vault: addr() }).returning();
  await db.insert(members).values({ businessId: biz!.id, userId: owner!.id, role: "owner" });
  return { owner: owner!, biz: biz! };
}

const at = new Date("2026-10-17T09:00:00Z");

describe("upgrade_applied notice (REL4-6)", () => {
  it("a sole owner who applies an upgrade gets one bell notice", async () => {
    const { owner, biz } = await soleOwnerBusiness();
    const input = {
      kind: "upgrade_applied",
      subject: `vault:${biz.vault}:upgrade`,
      actor: owner.id,
      inputs: { implementation: addr(), txHash: "0x" + "ab".repeat(32), operationId: "op-1", stateMatch: true },
      rule: "the owner applied a scheduled Vault implementation upgrade",
      outcome: "applied",
      txHash: "0x" + "ab".repeat(32),
    };
    await appendAppDecision(db, biz.id, input);
    await appendAppDecision(db, biz.id, input); // the same record twice rings once
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, owner.id), eq(notifications.kind, "upgrade_applied")));
    expect(rows).toHaveLength(1);
    const text = describeNotification({ kind: rows[0]!.kind, subject: rows[0]!.subject, body: rows[0]!.body as Record<string, unknown>, createdAt: at });
    expect(text.title).toBe("Your Vault was upgraded");
    expect(text.href).toBe("/business/settings");
  });
});

describe("lending_moved notice (LEND-3)", () => {
  it("reaches the owner once per transaction and names the amount", async () => {
    const { owner, biz } = await soleOwnerBusiness();
    const notice = { kind: "lending_moved", subject: null, body: { direction: "out", amount: "90999999", reason: "bills due in the buffer exceed the cash" }, dedupeKey: "lending_moved:0xfeed" };
    await notifyBusiness(db, biz.id, notice, { roles: ["owner"] });
    await notifyBusiness(db, biz.id, notice, { roles: ["owner"] });
    const rows = await db.select().from(notifications).where(and(eq(notifications.userId, owner.id), eq(notifications.kind, "lending_moved")));
    expect(rows).toHaveLength(1);
    const text = describeNotification({ kind: "lending_moved", subject: null, body: rows[0]!.body as Record<string, unknown>, createdAt: at });
    expect(text.title).toBe("Cash taken back from lending");
    expect(text.body).toBe("The Steward took $91.00 back from the lending vault. Bills due in the buffer exceed the cash.");
  });
});

describe("offer_received text (UI-24)", () => {
  it("names the vendor and the invoice", () => {
    const t = describeNotification({ kind: "offer_received", subject: "0x1", body: { vendorName: "Accra Cold Chain Supplies", invoiceNumber: "ACCS-2026-0007", discountPercent: "1.8" }, createdAt: at });
    expect(t.body).toBe("Accra Cold Chain Supplies offered 1.8% off on ACCS-2026-0007 to be paid early.");
  });
  it("older notices without a stored name still say which invoice", () => {
    const t = describeNotification({ kind: "offer_received", subject: "0x1", body: { invoiceNumber: "ACCS-2026-0007", discountPercent: "1.8" }, createdAt: at });
    expect(t.body).toBe("The vendor on ACCS-2026-0007 offered 1.8% off to be paid early.");
  });
});
