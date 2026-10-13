const BPS = 10_000n;

export interface ReservePlanInputs {
  /** The Vault's reserve policy and whether Circle currently allows it */
  enabled: boolean;
  entitled: boolean;
  maxReserveBps: number;
  minOperating: bigint;
  cash: bigint;
  /** USYC held and its value in USDC at the current price */
  shares: bigint;
  reserveValue: bigint;
  /** Cash to keep for the forecast buffer (e.g. next 30 days of bills) */
  buffer: bigint;
  /** Outflows due within the redemption lead time that cash doesn't cover */
  upcoming: bigint;
  /** Only sweep when the excess is at least this (avoid dust moves and same-day fee tiers) */
  minSweep: bigint;
  /** Extra redeemed above the shortfall, in bps */
  redeemMarginBps: number;
}

export type ReservePlan =
  | { action: "none"; reason: string }
  | { action: "subscribe"; assets: bigint; reason: string }
  | { action: "redeem"; assets: bigint; shares: bigint; reason: string };

/**
 * Keeps `max(minOperating, buffer, upcoming)` in cash and puts the excess in USYC within `maxReserveBps`; redeems the
 * shortfall (plus a margin) ahead of need. Pure arithmetic; the Vault re-checks floor and share onchain.
 */
export function planReserve(i: ReservePlanInputs): ReservePlan {
  const target = [i.minOperating, i.buffer, i.upcoming].reduce((a, b) => (a > b ? a : b));

  if (i.cash < target) {
    if (i.shares === 0n) return { action: "none", reason: "cash is below target but there is no reserve to redeem" };
    const shortfall = target - i.cash;
    const want = shortfall + (shortfall * BigInt(i.redeemMarginBps)) / BPS;
    const assets = want > i.reserveValue ? i.reserveValue : want;
    // shares proportional to value, rounded up so the redemption covers `assets`
    const shares = i.reserveValue === 0n ? 0n : (assets * i.shares + i.reserveValue - 1n) / i.reserveValue;
    return {
      action: "redeem",
      assets,
      shares: shares > i.shares ? i.shares : shares,
      reason: `cash ${i.cash} is below the ${target} needed for the buffer and upcoming bills`,
    };
  }

  if (!i.enabled) return { action: "none", reason: "the reserve is off for this Vault" };
  if (!i.entitled) return { action: "none", reason: "Circle hasn't allowlisted this Vault for USYC" };
  const excess = i.cash - target;
  // largest subscription that keeps reserve / (cash + reserve) within maxReserveBps
  const total = i.cash + i.reserveValue;
  const maxReserve = (total * BigInt(i.maxReserveBps)) / BPS;
  const room = maxReserve > i.reserveValue ? maxReserve - i.reserveValue : 0n;
  const assets = excess < room ? excess : room;
  if (assets < i.minSweep) return { action: "none", reason: `excess ${assets} is below the ${i.minSweep} sweep threshold` };
  return { action: "subscribe", assets, reason: `cash ${i.cash} is ${excess} above the ${target} target` };
}

export interface LendingPlanInputs {
  /** The Vault's lending policy and whether the venue could be read at all */
  enabled: boolean;
  venueSet: boolean;
  maxLendingBps: number;
  /** The Vault's one operating floor (the reserve policy's `minOperating`), shared with USYC */
  minOperating: bigint;
  cash: bigint;
  /** Venue shares held and their value by the venue's own `convertToAssets` (zero when `valueKnown` is false) */
  shares: bigint;
  lendingValue: bigint;
  valueKnown: boolean;
  /** The node's answer to redeeming all `shares` from the Vault's address, or why it refused */
  exit: { ok: true; assets: bigint } | { ok: false; reason: string };
  buffer: bigint;
  upcoming: bigint;
  minSweep: bigint;
  redeemMarginBps: number;
}

export type LendingPlan =
  | { action: "none"; reason: string; unavailable: bigint }
  | { action: "deposit"; assets: bigint; reason: string; unavailable: bigint }
  | { action: "redeem"; assets: bigint; shares: bigint; reason: string; unavailable: bigint };

/**
 * The same shape as `planReserve` for the lending venue, with one difference that matters: liquidity is never assumed.
 * Whatever the node says it can't pay out right now is counted in `unavailable`, never as cash the forecast may rely on,
 * and nothing more is put into a venue whose exit fails. Pure arithmetic; the Vault re-checks floor, cap and min-outs.
 */
export function planLending(i: LendingPlanInputs): LendingPlan {
  const target = [i.minOperating, i.buffer, i.upcoming].reduce((a, b) => (a > b ? a : b));
  // the part of the position the node says it can pay out now; the rest is shown as unavailable, never netted
  const payable = i.exit.ok ? (i.exit.assets < i.lendingValue || !i.valueKnown ? i.exit.assets : i.lendingValue) : 0n;
  const unavailable = i.shares === 0n ? 0n : i.lendingValue > payable ? i.lendingValue - payable : i.exit.ok ? 0n : i.lendingValue;

  if (i.shares > 0n && !i.exit.ok) {
    return {
      action: "none",
      reason: `the lending vault can't pay out right now (${i.exit.reason}); ${i.lendingValue} stays counted as unavailable`,
      unavailable,
    };
  }

  if (i.cash < target) {
    if (i.shares === 0n) return { action: "none", reason: "cash is below target but there is nothing in the lending vault", unavailable };
    const shortfall = target - i.cash;
    const want = shortfall + (shortfall * BigInt(i.redeemMarginBps)) / BPS;
    const assets = want > payable ? payable : want;
    if (assets === 0n || i.lendingValue === 0n) return { action: "none", reason: "the lending vault has nothing it can pay out now", unavailable };
    const shares = (assets * i.shares + i.lendingValue - 1n) / i.lendingValue;
    return {
      action: "redeem",
      assets,
      shares: shares > i.shares ? i.shares : shares,
      reason: `cash ${i.cash} is below the ${target} needed for the buffer and upcoming bills`,
      unavailable,
    };
  }

  if (!i.venueSet) return { action: "none", reason: "no lending vault is set for this Vault", unavailable };
  if (!i.enabled) return { action: "none", reason: "lending is off for this Vault", unavailable };
  if (!i.valueKnown) return { action: "none", reason: "the lending vault's value can't be read right now", unavailable };
  const excess = i.cash - target;
  const total = i.cash + i.lendingValue;
  const maxLending = (total * BigInt(i.maxLendingBps)) / BPS;
  const room = maxLending > i.lendingValue ? maxLending - i.lendingValue : 0n;
  const assets = excess < room ? excess : room;
  if (assets < i.minSweep) return { action: "none", reason: `excess ${assets} is below the ${i.minSweep} threshold`, unavailable };
  return { action: "deposit", assets, reason: `cash ${i.cash} is ${excess} above the ${target} target`, unavailable };
}

export interface LendingSample {
  at: Date;
  /** Raw asset units one whole share converts to */
  assets: bigint;
}

/** Shortest window a lending yield is shown over (plan 05zk); under it there is a share price and no rate */
export const MIN_LENDING_YIELD_DAYS = 7;

/**
 * A lending venue's realised yield, annualised in bps (simple, not compounded), from the venue's own share price between
 * the oldest and newest sample. Null while the samples span less than `MIN_LENDING_YIELD_DAYS`: never a published rate.
 */
export function measuredLendingYield(samples: LendingSample[]): { bps: number; days: number } | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const seconds = BigInt(Math.floor((last.at.getTime() - first.at.getTime()) / 1000));
  if (first.assets <= 0n || seconds < BigInt(MIN_LENDING_YIELD_DAYS) * 86_400n) return null;
  const bps = ((last.assets - first.assets) * 10_000n * 365n * 86_400n) / (first.assets * seconds);
  return { bps: Number(bps < 0n ? 0n : bps), days: Number(seconds / 86_400n) };
}
