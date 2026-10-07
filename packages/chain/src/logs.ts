import type { AbiEvent, Address, Log, PublicClient } from "viem";

export interface ScanOptions<TEvents extends readonly AbiEvent[]> {
  address: Address | Address[];
  events: TEvents;
  /** Never 0 on Arc: RPCs reject log queries from genesis. Use the deployment's `startBlock` or a saved cursor. */
  fromBlock: bigint;
  toBlock?: bigint;
  /** Blocks per request; halved on RPC range errors down to `minChunk` */
  chunk?: bigint;
  minChunk?: bigint;
  /** Requests in flight at once (default 1). Public RPCs rate-limit log queries, so keep this small. */
  concurrency?: number;
  /** First wait, in ms, before asking again after a rate-limit answer; it doubles each time (default 1000) */
  backoffMs?: number;
  /** Indexed-argument filter (needs exactly one event). The node drops other logs before answering, so replies stay small. */
  args?: Record<string, unknown>;
}
export interface ScanResult<TLog> {
  logs: TLog[];
  /** Highest block fully scanned; persist it and resume from `scannedTo + 1` */
  scannedTo: bigint;
}

const DEFAULT_CHUNK = 10_000n;
const DEFAULT_MIN_CHUNK = 100n;
const RATE_LIMIT_RETRIES = 4;

/** A provider saying "slow down" is not a range that is too big: asking for less won't help, waiting will */
export function isRateLimited(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  return /rate limit|too many requests|\b429\b|exceeds defined limit/i.test(text);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Reads decoded logs in block ranges, shrinking the range when the RPC refuses it. Filtering by `address` also keeps
 * out Arc's second, system-emitted USDC `Transfer` log (from 0xFF…FE), which would otherwise double-count transfers.
 */
export async function scanLogs<const TEvents extends readonly AbiEvent[]>(
  client: PublicClient,
  opts: ScanOptions<TEvents>,
): Promise<ScanResult<Log<bigint, number, false, undefined, true, TEvents>>> {
  if (opts.args && opts.events.length !== 1) throw new Error("an argument filter needs exactly one event");
  if (opts.fromBlock <= 0n) throw new Error("scan from the deployment's startBlock, never genesis (Arc prunes history)");
  const toBlock = opts.toBlock ?? (await client.getBlockNumber());
  const minChunk = opts.minChunk ?? DEFAULT_MIN_CHUNK;
  const workers = Math.max(1, Math.floor(opts.concurrency ?? 1));
  let chunk = opts.chunk ?? DEFAULT_CHUNK;
  const logs: Log<bigint, number, false, undefined, true, TEvents>[] = [];

  // Ranges not yet read: fresh ones are cut from `next` at the current size; ranges the RPC refused come back split in two.
  let next = opts.fromBlock;
  const retry: [bigint, bigint][] = [];
  let failure: unknown;
  const take = (): [bigint, bigint] | null => {
    let range: [bigint, bigint] | null = retry.pop() ?? null;
    if (!range) {
      if (next > toBlock) return null;
      const to = next + chunk - 1n > toBlock ? toBlock : next + chunk - 1n;
      range = [next, to];
      next = to + 1n;
    }
    // a refused range comes back larger than the size we have since learned to ask for
    while (range[1] - range[0] + 1n > chunk && range[1] - range[0] + 1n > minChunk) {
      const mid: bigint = range[0] + (range[1] - range[0]) / 2n;
      retry.push([mid + 1n, range[1]]);
      range = [range[0], mid];
    }
    return range;
  };

  const work = async () => {
    for (let range = take(); range && failure === undefined; range = take()) {
      const [from, to] = range;
      try {
        let waits = 0;
        for (;;) {
          try {
            const filter = opts.args && opts.events.length === 1 ? { event: opts.events[0], args: opts.args } : { events: opts.events };
            const batch = await client.getLogs({ address: opts.address, ...filter, fromBlock: from, toBlock: to, strict: true } as never);
            logs.push(...(batch as typeof logs));
            break;
          } catch (error) {
            if (!isRateLimited(error) || waits >= RATE_LIMIT_RETRIES) throw error;
            await pause((opts.backoffMs ?? 1_000) * 2 ** waits++);
          }
        }
      } catch (error) {
        if (isRateLimited(error) || to - from + 1n <= minChunk) {
          failure ??= error;
          return;
        }
        const half = (to - from + 1n) / 2n;
        chunk = half > minChunk ? half : minChunk;
        const mid = from + half - 1n;
        retry.push([mid + 1n, to], [from, mid]);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, work));
  if (failure !== undefined) throw failure;
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return { logs, scannedTo: toBlock };
}
