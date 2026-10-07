import { describe, expect, it } from "vitest";
import { discounted, formatDateTime, formatDay, showAmount, showBps, showDate, showMoney } from "@/lib/format";
import { vendorStatus } from "@/lib/invoice-status";

describe("display formats keep amounts exact", () => {
  it.each([
    ["2880.000000", "2,880.00"],
    ["15.375000", "15.375"],
    ["0.000001", "0.000001"],
    ["1234567.500000", "1,234,567.50"],
    ["0", "0.00"],
    ["100", "100.00"],
  ])("shows %s as %s", (v, out) => expect(showAmount(v)).toBe(out));

  it("shows money the way people write it, with the currency in front", () => {
    expect(showMoney("14000.000000", "USDC")).toBe("$14,000.00");
    expect(showMoney("2400.5", "EURC")).toBe("€2,400.50");
    expect(showMoney("0.000001", "USDC")).toBe("$0.000001");
    expect(showMoney("12.000000", "ACME")).toBe("12.00 ACME");
    expect(showMoney("1200.000000", "USDC")).not.toMatch(/\d\.\d{6}/);
  });

  it("writes days and moments the same on the server and in the browser, in UTC, naming the zone", () => {
    const now = new Date("2026-10-07T09:00:00Z");
    expect(formatDay(new Date("2026-10-04T23:59:00Z"), { now })).toBe("4 Oct");
    expect(formatDay("2025-12-31T00:00:00Z", { now })).toBe("31 Dec 2025");
    expect(formatDay(new Date("2026-10-04T10:00:00Z"), { now, year: "always" })).toBe("4 Oct 2026");
    expect(formatDateTime(new Date("2026-10-04T14:05:00Z"), { now })).toBe("4 Oct, 14:05 UTC");
    expect(formatDay("not a date")).toBe("Date unavailable");
    expect(formatDateTime("")).toBe("Date unavailable");
  });

  it("shows dates as UTC days and basis points as percentages", () => {
    expect(showDate(1_790_000_000)).toBe("21 Sep 2026");
    expect(showBps(150)).toBe("1.5");
    expect(showBps(75)).toBe("0.75");
    expect(showBps(2000)).toBe("20");
    expect(showBps(10_000)).toBe("100");
  });

  it("works a discounted amount the way the ledger does: credit − credit × bps / 10000, in integers", () => {
    expect(discounted("2400.000000", 6, 150)).toBe("2364.000000");
    // 1.000001 at 150 bps: the discount 0.0150000150… floors to 0.015000 (raw 15000), not rounded up
    expect(discounted("1.000001", 6, 150)).toBe("0.985001");
    expect(discounted("100.000000", 6, 0)).toBe("100.000000");
  });

  it("tells a vendor only true states", () => {
    expect(vendorStatus("verified").label).toBe("Sealed");
    expect(vendorStatus("held").label).toBe("Sealed");
    expect(vendorStatus("awaiting_approval").label).toBe("Sealed");
    expect(vendorStatus("paid").label).toBe("Paid");
    expect(vendorStatus("partially_paid").label).toBe("Partly paid");
    expect(vendorStatus("rejected").tone).toBe("red");
  });
});

import { businessStatus, trustName } from "@/lib/business-status";

describe("a business is told true states in plain words", () => {
  it("never shows an internal state word", () => {
    for (const s of ["received", "rejected", "verified", "held", "awaiting_approval", "scheduled", "partially_paid", "paid", "cancelled", "something_new"]) {
      const out = businessStatus(s);
      expect(`${out.label} ${out.note ?? ""}`).not.toMatch(/_/);
      expect(out.label).not.toBe(s);
    }
    for (const t of ["verified", "new_vendor", "blocked", "failed"]) expect(trustName(t).label).not.toMatch(/_/);
  });

  it("says why an invoice is held", () => {
    expect(businessStatus("held", { source: "human", kind: "delivery" }).note).toMatch(/delivery/i);
    expect(businessStatus("held", { source: "human", kind: "payment" }).note).toMatch(/person/i);
    expect(businessStatus("held", { source: "steward" }).note).toMatch(/Steward/);
  });
});

import { checksum, shortAddress } from "@/lib/format";

describe("addresses are always shown checksummed (B4)", () => {
  const lower = "0x5efb4dbb0d0cb4ee9eabf2bc7d62ba5f8c8bed78";
  it("gives the EIP-55 form and leaves anything else untouched", () => {
    const out = checksum(lower);
    expect(out).not.toBe(lower);
    expect(out.toLowerCase()).toBe(lower);
    expect(checksum(out)).toBe(out);
    expect(checksum("not an address")).toBe("not an address");
    expect(checksum("")).toBe("");
  });
  it("shortens the middle only for lists, from the checksummed form", () => {
    const short = shortAddress(lower);
    expect(short).toBe(`${checksum(lower).slice(0, 6)}…${checksum(lower).slice(-4)}`);
    expect(short.length).toBe(11);
    expect(shortAddress("0x12")).toBe("0x12");
  });
});
