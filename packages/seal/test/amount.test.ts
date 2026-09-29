import { describe, expect, it } from "vitest";

import {
  applyDiscount,
  bestTier,
  formatAmount,
  formatQuantity,
  isCanonicalAmount,
  lineAmount,
  parseAmount,
  parseQuantity,
  SealError,
} from "../src/index.js";

describe("amounts", () => {
  it("parses at full token precision without rounding", () => {
    expect(parseAmount("1250", 6)).toBe(1_250_000_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("85.333333", 6)).toBe(85_333_333n);
    expect(parseAmount("12", 0)).toBe(12n);
    expect(parseAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
  });

  it.each(["1.0000001", "-1", "+1", "1e6", " 1", "1 ", "01", "1.", ".5", "1,000", "", "0x10", "١"])(
    "rejects %j",
    (value) => {
      expect(() => parseAmount(value, 6)).toThrow(SealError);
    },
  );

  it("formats canonically with exactly the token's decimals", () => {
    expect(formatAmount(1_250_000_000n, 6)).toBe("1250.000000");
    expect(formatAmount(1n, 6)).toBe("0.000001");
    expect(formatAmount(0n, 6)).toBe("0.000000");
    expect(formatAmount(7n, 0)).toBe("7");
    expect(() => formatAmount(-1n, 6)).toThrow(SealError);
    expect(isCanonicalAmount("1250.000000", 6)).toBe(true);
    expect(isCanonicalAmount("1250", 6)).toBe(false);
    expect(isCanonicalAmount("1250.00000", 6)).toBe(false);
  });

  it("round-trips any raw amount", () => {
    for (const raw of [0n, 1n, 999_999n, 1_000_000n, 123_456_789_012_345n, 2n ** 128n]) {
      expect(parseAmount(formatAmount(raw, 6), 6)).toBe(raw);
    }
  });

  it("parses and formats quantities canonically", () => {
    expect(formatQuantity(parseQuantity("7.50"))).toBe("7.5");
    expect(formatQuantity(parseQuantity("10"))).toBe("10");
    expect(formatQuantity(parseQuantity("0.000001"))).toBe("0.000001");
    expect(() => parseQuantity("0")).toThrow(SealError);
    expect(() => parseQuantity("0.0000001")).toThrow(SealError);
  });

  it("rounds a line's quantity × price half up at token precision", () => {
    expect(lineAmount("7.5", 85_333_333n)).toBe(639_999_998n); // 639.9999975 → .999998
    expect(lineAmount("3", 33_333_333n)).toBe(99_999_999n);
    expect(lineAmount("0.5", 1n)).toBe(1n); // 0.5 unit rounds up
    expect(lineAmount("0.4", 1n)).toBe(0n);
  });
});

describe("quotes", () => {
  it("rounds the discount down, like InvoiceLedger._applyDiscount", () => {
    expect(applyDiscount(1_000_000n, 150)).toBe(985_000n);
    expect(applyDiscount(1n, 150)).toBe(1n);
    expect(applyDiscount(99n, 5000)).toBe(50n); // discount 49.5 → 49
    expect(applyDiscount(6_635_633_750n, 150)).toBe(6_536_099_244n);
  });

  it("refuses discounts the ledger would refuse", () => {
    expect(() => applyDiscount(1n, 5001)).toThrow(SealError);
    expect(() => applyDiscount(1n, -1)).toThrow(SealError);
    expect(() => applyDiscount(1n, 1.5)).toThrow(SealError);
  });

  it("picks the largest tier still open, inclusive of payBy", () => {
    const invoice = {
      earlyPay: [
        { payBy: 100n, discountBps: 150 },
        { payBy: 200n, discountBps: 75 },
      ],
    };
    expect(bestTier(invoice, 100n)?.index).toBe(0);
    expect(bestTier(invoice, 101n)?.index).toBe(1);
    expect(bestTier(invoice, 200n)?.tier.discountBps).toBe(75);
    expect(bestTier(invoice, 201n)).toBeUndefined();
    expect(bestTier({ earlyPay: [] }, 0n)).toBeUndefined();
  });
});
