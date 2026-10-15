import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, users } from "@symbolon/db";
import {
  DELIVERABLE_KINDS,
  MAX_DELIVERIES_PER_HOUR,
  cleanPrefs,
  isDeliverableKind,
  kindEnabled,
  setNoticeListener,
  withinRateGuard,
} from "../src/notice-delivery.js";
import { notify, notifyMany } from "../src/notify.js";

afterEach(() => setNoticeListener(null));

describe("notice delivery policy", () => {
  it("only allow-listed kinds can be delivered, and business kinds default on, vendor kinds off", () => {
    expect(isDeliverableKind("approval_needed")).toBe(true);
    expect(isDeliverableKind("invoice_received")).toBe(false);
    expect(kindEnabled(undefined, "telegram", "approval_needed")).toBe(true);
    expect(kindEnabled(undefined, "telegram", "invoice_paid")).toBe(false);
    expect(kindEnabled({}, "push", "shortfall")).toBe(true);
    expect(kindEnabled({ telegram: { kinds: { not_a_kind: true } } }, "telegram", "not_a_kind")).toBe(false);
  });

  it("a person's choices win, per channel, and the master switch silences a channel", () => {
    const prefs = { telegram: { kinds: { invoice_paid: true, approval_needed: false } }, push: { master: false } };
    expect(kindEnabled(prefs, "telegram", "invoice_paid")).toBe(true);
    expect(kindEnabled(prefs, "telegram", "approval_needed")).toBe(false);
    expect(kindEnabled(prefs, "push", "approval_needed")).toBe(false);
    expect(kindEnabled(prefs, "push", "invoice_paid")).toBe(false);
  });

  it("stored preferences are cleaned, never trusted", () => {
    expect(cleanPrefs("junk")).toEqual({});
    expect(cleanPrefs({ telegram: { master: "yes", kinds: { invoice_paid: true, bogus: true, shortfall: "no" } }, sms: { master: true } })).toEqual({
      telegram: { kinds: { invoice_paid: true } },
    });
  });

  it("the hourly cap is shared and exact", () => {
    expect(withinRateGuard(MAX_DELIVERIES_PER_HOUR - 1)).toBe(true);
    expect(withinRateGuard(MAX_DELIVERIES_PER_HOUR)).toBe(false);
  });

  it("every listed kind is unique", () => {
    const all = [...DELIVERABLE_KINDS.business, ...DELIVERABLE_KINDS.vendor];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("listener hook", () => {
  it("is told only about newly inserted rows, and a failing listener never fails the notice", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "a@example.com" }).returning();
    const seen: string[][] = [];
    setNoticeListener(async (ids) => {
      seen.push(ids);
      throw new Error("channel down");
    });
    const first = await notify(db, { userId: u!.id, kind: "approval_needed", body: {}, dedupeKey: "k1" });
    const again = await notify(db, { userId: u!.id, kind: "approval_needed", body: {}, dedupeKey: "k1" });
    const many = await notifyMany(db, [
      { userId: u!.id, kind: "shortfall", body: {}, dedupeKey: "k2" },
      { userId: u!.id, kind: "approval_needed", body: {}, dedupeKey: "k1" },
    ]);
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(many.inserted).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual([first.id]);
    expect(seen[1]).toHaveLength(1);
  });
});
