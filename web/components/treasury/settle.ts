import type { TreasuryState } from "@/lib/server/treasury";

/**
 * After the wallet has sent a transaction, the chain hasn't necessarily included it yet, and Arc's public endpoints lag each
 * other by a few blocks, so reading the balance once straight away shows the old number and then nothing ever corrects it
 * (found 2026-10-08: funded, still unchanged after ten minutes). The page keeps reading until the holdings differ from what it
 * showed before, and only then says the money arrived.
 */

/** What changes when money moves: the two balances and the reserve */
export const holdingsKey = (s: TreasuryState): string => JSON.stringify([s.balances.usdc?.amount ?? null, s.balances.eurc?.amount ?? null, s.reserve.shares, s.reserve.reserveValue]);

/** A read from an older block than the one on screen is never shown over it (a lagging endpoint must not undo a newer read) */
export const isNotOlder = (next: TreasuryState, current: TreasuryState): boolean => {
  try {
    return BigInt(next.block) >= BigInt(current.block);
  } catch {
    return true;
  }
};

export type SettleResult = "changed" | "unchanged";

export async function settleUntilChanged(opts: {
  before: string;
  /** The treasury as Arc shows it now, or null when it couldn't be read this time */
  read: () => Promise<TreasuryState | null>;
  /** Called with every read that is newer or equal to what is shown */
  show: (state: TreasuryState) => void;
  current: () => TreasuryState;
  tries?: number;
  everyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SettleResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < (opts.tries ?? 30); i++) {
    await sleep(opts.everyMs ?? 3_000);
    const next = await opts.read();
    if (!next || !isNotOlder(next, opts.current())) continue;
    opts.show(next);
    if (holdingsKey(next) !== opts.before) return "changed";
  }
  return "unchanged";
}
