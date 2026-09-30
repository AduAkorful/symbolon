import { describe, expect, it } from "vitest";

import { annualizedBps, counterFor, decideTiming, DEFAULT_EARLY_PAY, forecast, outflowsWithin, planReserve, runwayDays, tokenShortfalls } from "../src/index.js";
import { DAY, NOW, TOKEN, USDC } from "./fixtures.js";

describe("Early Pay timing", () => {
  const base = {
    now: NOW,
    dueDate: NOW + 30n * DAY,
    credit: 10_000n * USDC,
    options: [{ kind: "tier" as const, tierIndex: 0, discountBps: 150, payBy: NOW + 3n * DAY }],
    reserveYieldBps: 460,
    program: DEFAULT_EARLY_PAY,
    operatingCash: 100_000n * USDC,
    buffer: 20_000n * USDC,
    earlyPayCommitted: 0n,
  };

  it("annualizes a discount by days early", () => {
    expect(annualizedBps(150, 30n)).toBe(1825n); // 1.5% for 30 days ≈ 18.25%/yr
    expect(annualizedBps(100, 0n)).toBe(36_500n); // same-day counts as one day
  });

  it("takes a discount that beats reserve yield + spread and keeps the buffer", () => {
    const d = decideTiming(base);
    expect(d.action).toBe("pay_now_discounted");
    if (d.action === "pay_now_discounted") expect(d.paid).toBe(9_850n * USDC);
  });

  it("pays on the due date when the discount doesn't clear the hurdle", () => {
    const d = decideTiming({ ...base, options: [{ ...base.options[0]!, discountBps: 50 }] }); // 6.08%/yr < 7.6%
    expect(d.action).toBe("pay_on_due_date");
    expect(d.assessed[0]!.reasons.join()).toMatch(/hurdle/);
  });

  it("respects the buffer, the cap, expiry and the program switch", () => {
    expect(decideTiming({ ...base, operatingCash: 25_000n * USDC }).assessed[0]!.reasons.join()).toMatch(/buffer/);
    expect(decideTiming({ ...base, earlyPayCommitted: 15_000n * USDC }).assessed[0]!.reasons.join()).toMatch(/cap/);
    expect(decideTiming({ ...base, now: NOW + 4n * DAY }).action).toBe("pay_on_due_date");
    expect(decideTiming({ ...base, program: { ...DEFAULT_EARLY_PAY, enabled: false } }).action).toBe("pay_on_due_date");
  });

  it("picks the largest saving among qualifying options and pays overdue invoices now", () => {
    const d = decideTiming({
      ...base,
      options: [...base.options, { kind: "offer", discountBps: 200, payBy: NOW + DAY }],
    });
    expect(d.action === "pay_now_discounted" && d.option.discountBps).toBe(200);
    expect(decideTiming({ ...base, dueDate: NOW - DAY }).action).toBe("pay_now_overdue");
  });
});

describe("counterFor", () => {
  const base = {
    now: NOW,
    dueDate: NOW + 30n * DAY,
    credit: 10_000n * USDC,
    options: [],
    reserveYieldBps: 460,
    program: DEFAULT_EARLY_PAY,
    operatingCash: 100_000n * USDC,
    buffer: 20_000n * USDC,
    earlyPayCommitted: 0n,
  };

  it("returns undefined if the offer already clears hurdle, buffer, and cap", () => {
    const offer = { kind: "offer" as const, discountBps: 150, payBy: NOW + 3n * DAY };
    expect(counterFor({ ...base, offer })).toBeUndefined();
  });

  it("proposes the minimal discount that clears the hurdle when offer is too low", () => {
    const offer = { kind: "offer" as const, discountBps: 50, payBy: NOW + 3n * DAY };
    // hurdle = 460 + 300 = 760 bps. For 30 days early, 63 bps gives annualized 766 bps >= 760.
    const counter = counterFor({ ...base, offer });
    expect(counter).toBeDefined();
    expect(counter?.discountBps).toBe(63);
  });

  it("returns undefined when program is disabled, expired, or already due", () => {
    const offer = { kind: "offer" as const, discountBps: 50, payBy: NOW + 3n * DAY };
    expect(counterFor({ ...base, offer, program: { ...DEFAULT_EARLY_PAY, enabled: false } })).toBeUndefined();
    expect(counterFor({ ...base, offer, now: NOW + 4n * DAY })).toBeUndefined();
    expect(counterFor({ ...base, offer, dueDate: NOW - DAY })).toBeUndefined();
  });

  it("returns undefined when cash buffer or cap cannot be satisfied even at max discount", () => {
    const offer = { kind: "offer" as const, discountBps: 50, payBy: NOW + 3n * DAY };
    // Operating cash is 24k, buffer 20k, available cash is 4k < min paid at max discount 5k
    expect(counterFor({ ...base, offer, operatingCash: 24_000n * USDC })).toBeUndefined();
  });
});

describe("forecast", () => {
  const flows = [
    { at: NOW + DAY, amount: 30n, direction: "out" as const, ref: "a" },
    { at: NOW - 5n * DAY, amount: 10n, direction: "out" as const, ref: "overdue" },
    { at: NOW + 2n * DAY, amount: 5n, direction: "in" as const, ref: "b" },
    { at: NOW + 40n * DAY, amount: 100n, direction: "out" as const, ref: "later" },
  ];

  it("lays flows on days, overdue on day 0", () => {
    const days = forecast(100n, flows, NOW, 3);
    expect(days.map((d) => d.balance)).toEqual([90n, 60n, 65n]);
  });

  it("sums the buffer window and finds the runway", () => {
    expect(outflowsWithin(flows, NOW, 30)).toBe(40n);
    expect(runwayDays(100n, flows, NOW, 60)).toBe(Number(40n)); // the day-40 bill breaks it
    expect(runwayDays(1_000n, flows, NOW, 60)).toBeUndefined();
  });
});

describe("token shortfalls", () => {
  const EURC = "0x00000000000000000000000000000000000000e0";
  const flows = [
    { at: NOW + 5n * DAY, amount: 300n, direction: "out" as const, ref: "eur-1", token: EURC },
    { at: NOW - DAY, amount: 50n, direction: "out" as const, ref: "eur-overdue", token: EURC },
    { at: NOW + 40n * DAY, amount: 900n, direction: "out" as const, ref: "eur-late", token: EURC },
    { at: NOW + 2n * DAY, amount: 100n, direction: "out" as const, ref: "usd-1", token: TOKEN },
    { at: NOW + DAY, amount: 999n, direction: "in" as const, ref: "eur-in", token: EURC },
  ];

  it("flags a token whose dues exceed its own balance, never netting another token", () => {
    const balances = new Map([[TOKEN, 10_000n], [EURC.toUpperCase().replace("0X", "0x"), 200n]]);
    expect(tokenShortfalls(balances, flows, NOW, 30)).toEqual([
      { token: EURC, balance: 200n, due: 350n, short: 150n, refs: ["eur-1", "eur-overdue"] },
    ]);
  });

  it("is empty when every token is covered, and treats a missing balance as zero", () => {
    expect(tokenShortfalls(new Map([[TOKEN, 100n], [EURC, 350n]]), flows, NOW, 30)).toEqual([]);
    expect(tokenShortfalls(new Map([[TOKEN, 100n]]), flows, NOW, 30)[0]?.short).toBe(350n);
  });
});

describe("reserve planner", () => {
  const base = {
    enabled: true,
    entitled: true,
    maxReserveBps: 8_000,
    minOperating: 50_000n * USDC,
    cash: 300_000n * USDC,
    shares: 0n,
    reserveValue: 0n,
    buffer: 100_000n * USDC,
    upcoming: 0n,
    minSweep: 1_000n * USDC,
    redeemMarginBps: 100,
  };

  it("sweeps the excess over the buffer", () => {
    expect(planReserve(base)).toMatchObject({ action: "subscribe", assets: 200_000n * USDC });
  });

  it("stays within the max reserve share", () => {
    const p = planReserve({ ...base, maxReserveBps: 5_000 });
    expect(p).toMatchObject({ action: "subscribe", assets: 150_000n * USDC });
  });

  it("redeems the shortfall plus a margin ahead of need, rounding shares up", () => {
    const p = planReserve({ ...base, cash: 40_000n * USDC, shares: 87_826n * USDC, reserveValue: 100_000n * USDC, upcoming: 110_000n * USDC });
    expect(p.action).toBe("redeem");
    if (p.action === "redeem") {
      expect(p.assets).toBe(70_700n * USDC); // 70,000 shortfall + 1%
      expect(p.shares * 100_000n * USDC).toBeGreaterThanOrEqual(p.assets * 87_826n * USDC);
    }
  });

  it("does nothing when off, not entitled, or below the sweep threshold", () => {
    expect(planReserve({ ...base, enabled: false }).action).toBe("none");
    expect(planReserve({ ...base, entitled: false }).reason).toMatch(/allowlisted/);
    expect(planReserve({ ...base, cash: 100_500n * USDC }).action).toBe("none");
  });
});
