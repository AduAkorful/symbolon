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
}

export interface ScanResult<TLog> {
  logs: TLog[];
  /** Highest block fully scanned; persist it and resume from `scannedTo + 1` */
  scannedTo: bigint;
}

const DEFAULT_CHUNK = 10_000n;
const DEFAULT_MIN_CHUNK = 100n;

/**
 * Reads decoded logs in block ranges, shrinking the range when the RPC refuses it. Filtering by `address` also keeps
 * out Arc's second, system-emitted USDC `Transfer` log (from 0xFF…FE), which would otherwise double-count transfers.
 */
export async function scanLogs<const TEvents extends readonly AbiEvent[]>(
  client: PublicClient,
  opts: ScanOptions<TEvents>,
): Promise<ScanResult<Log<bigint, number, false, undefined, true, TEvents>>> {
  if (opts.fromBlock <= 0n) throw new Error("scan from the deployment's startBlock, never genesis (Arc prunes history)");
  const toBlock = opts.toBlock ?? (await client.getBlockNumber());
  const minChunk = opts.minChunk ?? DEFAULT_MIN_CHUNK;
  let chunk = opts.chunk ?? DEFAULT_CHUNK;
  const logs: Log<bigint, number, false, undefined, true, TEvents>[] = [];

  let from = opts.fromBlock;
  while (from <= toBlock) {
    const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
    try {
      const batch = await client.getLogs({ address: opts.address, events: opts.events, fromBlock: from, toBlock: to, strict: true } as never);
      logs.push(...(batch as typeof logs));
      from = to + 1n;
    } catch (error) {
      if (chunk <= minChunk) throw error;
      chunk = chunk / 2n > minChunk ? chunk / 2n : minChunk;
    }
  }
  logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  return { logs, scannedTo: toBlock };
}
