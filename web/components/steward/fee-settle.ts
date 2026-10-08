/**
 * After the owner tops up the Steward's fee balance, the wallet returns a transaction hash before the chain has included it, and
 * Arc's public endpoints lag each other by a few blocks, so one read straight away shows the old balance and the page never
 * corrects it (found 2026-10-08, same cause as the Treasury). Read until the balance differs from what was on screen.
 */
export type FeeView = { formatted: string; raw: string | null };

export type FeeSettle = "changed" | "unchanged";

export async function settleFee(opts: {
  /** The raw balance shown before the top-up */
  before: string | null;
  /** The balance as Arc shows it now, or null when it could not be read this time */
  read: () => Promise<FeeView | null>;
  show: (fee: FeeView) => void;
  tries?: number;
  everyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<FeeSettle> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < (opts.tries ?? 30); i++) {
    await sleep(opts.everyMs ?? 3_000);
    const next = await opts.read();
    if (!next || next.raw === null) continue;
    // a lagging endpoint can answer with an older, smaller balance; only a different number counts as news
    if (next.raw !== opts.before) {
      opts.show(next);
      return "changed";
    }
  }
  return "unchanged";
}
