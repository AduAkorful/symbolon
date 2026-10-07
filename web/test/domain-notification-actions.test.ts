import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { businesses, createTestDb, members, notifications, seals, users } from "@symbolon/db";
import { arcTestnet } from "@symbolon/chain";
vi.mock("server-only", () => ({}));
import { appendAppDecision } from "@/lib/server/app-decisions";

describe("transactional action notification dispatch", () => {
  it("awaiting-second excludes the original confirmer and every other business", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    const [a, b, outsider] = await db.insert(users).values([{ email: "first@notifications.test" }, { email: "second@notifications.test" }, { email: "outsider@notifications.test" }]).returning();
    const [business, other] = await db.insert(businesses).values([{ chainId: arcTestnet.id, name: "First" }, { chainId: arcTestnet.id, name: "Other" }]).returning();
    await db.insert(members).values([{ businessId: business!.id, userId: a!.id, role: "owner" }, { businessId: business!.id, userId: b!.id, role: "approver" }, { businessId: other!.id, userId: outsider!.id, role: "owner" }]);
    const action = { kind: "vendor_verification_awaiting_second", actor: a!.id, inputs: { verificationId: "verification-1" }, rule: "second required", outcome: "awaiting_second" };
    await db.transaction((tx) => appendAppDecision(tx, business!.id, action));
    await appendAppDecision(db, business!.id, action);
    expect(await db.select().from(notifications)).toEqual([expect.objectContaining({ userId: b!.id, kind: "verification_awaiting_second", dedupeKey: "verif:verification-1" })]);
    await db.$client.close();
  });
  it("verified payout actions notify the Seal's user and dedupe receipt retries", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    const address = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
    const [vendor] = await db.insert(users).values({ wallet: address }).returning();
    const [business] = await db.insert(businesses).values({ chainId: arcTestnet.id, name: "Payer" }).returning();
    await db.insert(seals).values({ address, userId: vendor!.id, handle: "notice-vendor", displayName: "Vendor" });
    const action = { kind: "payout_change_confirmed", subject: address, actor: "owner", inputs: { requestId: "request-1" }, rule: "receipt confirmed", outcome: "confirmed" };
    await appendAppDecision(db, business!.id, action, `0x${"11".repeat(32)}`);
    await appendAppDecision(db, business!.id, action, `0x${"11".repeat(32)}`);
    expect(await db.select().from(notifications)).toEqual([expect.objectContaining({ userId: vendor!.id, kind: "payout_change_confirmed" })]);
    await db.$client.close();
  });
});
