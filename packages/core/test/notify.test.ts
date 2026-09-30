import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, notifications, users } from "@symbolon/db";
import { notify, notifyMany } from "../src/notify.js";

describe("notify helper", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let userId1: string;
  let userId2: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [u1] = await db.insert(users).values({ email: "user1@example.com" }).returning();
    const [u2] = await db.insert(users).values({ email: "user2@example.com" }).returning();
    userId1 = u1!.id;
    userId2 = u2!.id;
  });

  it("inserts a notification and deduplicates on dedupeKey", async () => {
    const res1 = await notify(db, {
      userId: userId1,
      kind: "approval_needed",
      subject: "0x1234",
      body: { amount: "100" },
      dedupeKey: "approval:0x1234",
    });
    expect(res1.duplicate).toBe(false);
    expect(res1.id).toBeDefined();

    // Repeat with same dedupeKey
    const res2 = await notify(db, {
      userId: userId1,
      kind: "approval_needed",
      subject: "0x1234",
      body: { amount: "100" },
      dedupeKey: "approval:0x1234",
    });
    expect(res2.duplicate).toBe(true);
    expect(res2.id).toBeUndefined();

    // Count is 1
    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupeKey).toBe("approval:0x1234");
  });

  it("allows same dedupeKey for different users", async () => {
    const r1 = await notify(db, {
      userId: userId1,
      kind: "steward_run_failed",
      subject: "run_1",
      body: { error: "fee" },
      dedupeKey: "run:run_1",
    });
    const r2 = await notify(db, {
      userId: userId2,
      kind: "steward_run_failed",
      subject: "run_1",
      body: { error: "fee" },
      dedupeKey: "run:run_1",
    });
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(false);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
  });

  it("allows multiple null dedupeKeys", async () => {
    const r1 = await notify(db, {
      userId: userId1,
      kind: "info",
      body: { note: "first" },
    });
    const r2 = await notify(db, {
      userId: userId1,
      kind: "info",
      body: { note: "second" },
    });
    expect(r1.duplicate).toBe(false);
    expect(r2.duplicate).toBe(false);

    const rows = await db.select().from(notifications);
    expect(rows).toHaveLength(2);
  });

  it("handles notifyMany with duplicates", async () => {
    const res = await notifyMany(db, [
      { userId: userId1, kind: "k1", body: {}, dedupeKey: "key:1" },
      { userId: userId2, kind: "k1", body: {}, dedupeKey: "key:1" },
    ]);
    expect(res.inserted).toBe(2);
    expect(res.duplicates).toBe(0);

    const res2 = await notifyMany(db, [
      { userId: userId1, kind: "k1", body: {}, dedupeKey: "key:1" }, // duplicate
      { userId: userId1, kind: "k2", body: {}, dedupeKey: "key:2" }, // new
    ]);
    expect(res2.inserted).toBe(1);
    expect(res2.duplicates).toBe(1);
  });
});
