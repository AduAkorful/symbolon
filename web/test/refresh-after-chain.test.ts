import { describe, expect, it, vi } from "vitest";
import { CHAIN_REFRESH_DELAYS_MS, refreshAfterChain } from "../lib/client/refresh";

describe("refreshing after a transaction", () => {
  it("refreshes at once and again later, so a lagging endpoint cannot leave the page on the old state", () => {
    const router = { refresh: vi.fn() };
    const scheduled: number[] = [];
    refreshAfterChain(router, (fn, ms) => { scheduled.push(ms); fn(); });
    expect(scheduled).toEqual([...CHAIN_REFRESH_DELAYS_MS]);
    expect(router.refresh).toHaveBeenCalledTimes(1 + CHAIN_REFRESH_DELAYS_MS.length);
  });
});
