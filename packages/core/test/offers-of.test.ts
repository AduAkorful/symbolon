import { describe, expect, it } from "vitest";
import { offersOf } from "../src/steward.js";

describe("the offers a decision looked at (plan 05zu)", () => {
  const tier = { kind: "tier", discountBps: 100, payBy: "10" };
  const offer = (bps: number, payBy: string) => ({ kind: "offer", discountBps: bps, payBy });

  it("is the same for the same offers in any order, ignoring tiers and per-run figures", () => {
    const a = { options: [offer(220, "50"), tier, { ...offer(150, "40"), annualizedBps: 9n, clears: false }] };
    const b = { options: [offer(150, "40"), offer(220, "50")] };
    expect(offersOf(a)).toBe(offersOf(b));
  });
  it("changes when an offer arrives or one changes", () => {
    const before = { options: [offer(150, "40")] };
    expect(offersOf({ options: [offer(150, "40"), offer(220, "50")] })).not.toBe(offersOf(before));
    expect(offersOf({ options: [offer(160, "40")] })).not.toBe(offersOf(before));
    expect(offersOf({ options: [offer(150, "41")] })).not.toBe(offersOf(before));
  });
  it("is empty for a record with no offers", () => {
    expect(offersOf(undefined)).toBe("[]");
    expect(offersOf({ options: [tier] })).toBe("[]");
  });
});
