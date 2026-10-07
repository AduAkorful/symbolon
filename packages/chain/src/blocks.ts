import type { PublicClient } from "viem";

/**
 * The newest block at or before `timestamp` (unix seconds), searched between `lo` and `hi` (default: the chain's head).
 * Returns `lo` when even that block is later than the time asked for. Alternates interpolation (block times are nearly
 * even, so it lands close in a few reads) with bisection (so the worst case is still about twice a plain binary search).
 */
export async function blockAtOrBefore(client: PublicClient, timestamp: bigint, opts: { lo: bigint; hi?: bigint }): Promise<bigint> {
  const time = async (blockNumber: bigint) => (await client.getBlock({ blockNumber })).timestamp;
  let lo = opts.lo;
  let hi = opts.hi ?? (await client.getBlockNumber());
  let tLo = await time(lo);
  if (tLo >= timestamp) return lo;
  if (hi <= lo) return lo;
  let tHi = await time(hi);
  if (tHi <= timestamp) return hi;

  // from here: time(lo) < timestamp < time(hi)
  for (let step = 0; hi - lo > 1n; step++) {
    let guess = step % 2 === 0 ? lo + ((timestamp - tLo) * (hi - lo)) / (tHi - tLo) : lo + (hi - lo) / 2n;
    if (guess <= lo) guess = lo + 1n;
    if (guess >= hi) guess = hi - 1n;
    const t = await time(guess);
    if (t <= timestamp) {
      lo = guess;
      tLo = t;
    } else {
      hi = guess;
      tHi = t;
    }
  }
  return lo;
}
