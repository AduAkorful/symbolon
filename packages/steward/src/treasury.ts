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
