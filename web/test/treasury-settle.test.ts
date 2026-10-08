import { describe, expect, it, vi } from "vitest";
import type { TreasuryState } from "@/lib/server/treasury";
import { holdingsKey, isNotOlder, settleUntilChanged } from "@/components/treasury/settle";

vi.mock("server-only", () => ({}));

const state = (usdc: string, block: string, eurc = "0", shares = "0", reserveValue = "0"): TreasuryState =>
  ({ block, balances: { usdc: { amount: usdc } as never, eurc: { amount: eurc } as never }, reserve: { shares, reserveValue } }) as unknown as TreasuryState;
const noWait = async () => {};

describe("showing a deposit that the chain has not included yet (found 2026-10-08)", () => {
  it("keeps reading until the balance differs, then reports it arrived, and shows every newer read on the way", async () => {
    const reads = [state("1", "100"), state("1", "101"), state("501", "102")];
    const shown: string[] = [];
    let current = state("1", "99");
    const result = await settleUntilChanged({ before: holdingsKey(current), read: async () => reads.shift() ?? null, show: (s) => { current = s; shown.push(s.block); }, current: () => current, sleep: noWait });
    expect(result).toBe("changed");
    expect(shown).toEqual(["100", "101", "102"]);
    expect(reads).toHaveLength(0);
  });

  it("never lets a read from an older block replace a newer one (endpoints lag each other)", async () => {
    expect(isNotOlder(state("1", "90"), state("1", "100"))).toBe(false);
    expect(isNotOlder(state("1", "100"), state("1", "100"))).toBe(true);
    const shown: string[] = [];
    const current = state("1", "100");
    const reads = [state("1", "95"), state("501", "101")];
    await settleUntilChanged({ before: holdingsKey(current), read: async () => reads.shift() ?? null, show: (s) => shown.push(s.block), current: () => current, sleep: noWait, tries: 2 });
    expect(shown).toEqual(["101"]);
  });

  it("gives up after its tries without claiming the money arrived, and survives reads that fail", async () => {
    const current = state("1", "100");
    let n = 0;
    const result = await settleUntilChanged({ before: holdingsKey(current), read: async () => (++n % 2 ? null : state("1", "100")), show: () => {}, current: () => current, sleep: noWait, tries: 6 });
    expect(result).toBe("unchanged");
    expect(n).toBe(6);
  });

  it("counts a change in either balance or the reserve as money having moved", () => {
    const base = holdingsKey(state("1", "1"));
    expect(holdingsKey(state("2", "1"))).not.toBe(base);
    expect(holdingsKey(state("1", "1", "5"))).not.toBe(base);
    expect(holdingsKey(state("1", "1", "0", "7"))).not.toBe(base);
    expect(holdingsKey(state("1", "2"))).toBe(base); // a newer block alone is not money moving
  });
});
