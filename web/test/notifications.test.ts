import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createTestDb, users, type Database } from "@symbolon/db";
import { notify } from "@symbolon/core";
import { describeNotification } from "@/lib/server/notification-text";
import { getUnreadNotificationCount, listNotifications, markNotifications } from "@/lib/server/notifications";

describe("notifications", () => {
  let db: Database;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [uA] = await db.insert(users).values({ email: "usera@example.com" }).returning();
    const [uB] = await db.insert(users).values({ email: "userb@example.com" }).returning();
    userA = uA!.id;
    userB = uB!.id;
  });

  describe("describeNotification", () => {
    it("formats approval_needed notification", () => {
      const res = describeNotification({
        kind: "approval_needed",
        subject: "0x1234abcd",
        body: { invoiceNumber: "INV-100", vendorName: "Acme Supply", total: "$5,000.00" },
        createdAt: new Date(),
      });
      expect(res.title).toBe("Approval needed: INV-100");
      expect(res.body).toContain("Acme Supply · $5,000.00");
      expect(res.href).toBe("/business/inbox/0x1234abcd");
    });

    it("formats delivery_rejected with truncated reason", () => {
      const longReason = "a".repeat(200);
      const res = describeNotification({
        kind: "delivery_rejected",
        subject: "0x5678",
        body: { reason: longReason },
        createdAt: new Date(),
      });
      expect(res.title).toBe("Delivery rejected");
      expect(res.body.length).toBeLessThan(130);
      expect(res.body).toContain("…");
    });

    it("safely handles unknown kind", () => {
      const res = describeNotification({
        kind: "some_future_kind",
        subject: null,
        body: {},
        createdAt: new Date(),
      });
      expect(res.title).toBe("Notice: some future kind");
      expect(res.href).toBeUndefined();
    });
  });

  describe("service & isolation", () => {
    it("lists only user's own notifications and counts unread accurately", async () => {
      await notify(db, {
        userId: userA,
        kind: "approval_needed",
        subject: "0x01",
        body: { total: "$100" },
        dedupeKey: "app:0x01",
      });
      await notify(db, {
        userId: userA,
        kind: "steward_run_failed",
        body: { reason: "low fee" },
        dedupeKey: "run:1",
      });
      await notify(db, {
        userId: userB,
        kind: "invoice_paid",
        subject: "0x02",
        body: {},
        dedupeKey: "paid:0x02",
      });

      expect(await getUnreadNotificationCount(db, userA)).toBe(2);
      expect(await getUnreadNotificationCount(db, userB)).toBe(1);

      const listA = await listNotifications(db, userA);
      expect(listA.total).toBe(2);
      expect(listA.unreadCount).toBe(2);
      expect(listA.items).toHaveLength(2);
      expect(listA.items.map((i) => i.kind)).toEqual(["steward_run_failed", "approval_needed"]);

      const listB = await listNotifications(db, userB);
      expect(listB.total).toBe(1);
      expect(listB.items[0]?.kind).toBe("invoice_paid");
    });

    it("marks read, unread, and read-all without touching other users", async () => {
      const n1 = await notify(db, {
        userId: userA,
        kind: "k1",
        body: {},
        dedupeKey: "k1",
      });
      const n2 = await notify(db, {
        userId: userA,
        kind: "k2",
        body: {},
        dedupeKey: "k2",
      });
      const nB = await notify(db, {
        userId: userB,
        kind: "kb",
        body: {},
        dedupeKey: "kb",
      });

      // User A attempts to mark user B's notification -> ignored
      await markNotifications(db, userA, "read", [nB.id!]);
      expect(await getUnreadNotificationCount(db, userB)).toBe(1);

      // User A marks n1 read
      await markNotifications(db, userA, "read", [n1.id!]);
      expect(await getUnreadNotificationCount(db, userA)).toBe(1);

      // User A marks n1 unread
      await markNotifications(db, userA, "unread", [n1.id!]);
      expect(await getUnreadNotificationCount(db, userA)).toBe(2);

      // User A marks all read
      await markNotifications(db, userA, "read-all");
      expect(await getUnreadNotificationCount(db, userA)).toBe(0);
      expect(await getUnreadNotificationCount(db, userB)).toBe(1);
    });
  });
});
