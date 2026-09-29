import { describe, expect, it } from "vitest";
import { discounted, showAmount, showBps, showDate } from "@/lib/format";
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

  it("shows dates as UTC days and basis points as percentages", () => {
    expect(showDate(1_790_000_000)).toBe("2026-09-21");
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
