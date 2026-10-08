import { eq, sql } from "drizzle-orm";
import { getAbiItem, type PublicClient } from "viem";

import { invoiceLedgerAbi, scanLogs, vaultFactories, vaultFactoryAbi, type Deployment } from "@symbolon/chain";
import { syncCursors, type Database } from "@symbolon/db";
import { storeEvents } from "./sync.js";

const SETTLED = [getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" })] as const;
const VAULT_CREATED = [getAbiItem({ abi: vaultFactoryAbi, name: "VaultCreated" })] as const;

/** Log requests in flight at once; public RPCs rate-limit log queries (see sync.ts) */
const CONCURRENCY = 2;
/**
 * Blocks one run reads per stream: the cursor makes the next run continue, so a long history fills in over a few calls. Arc's RPCs
 * answer log queries of about 5,000 blocks at most, so this is a few dozen requests per stream; about 30 seconds at the speed the
 * public RPC allows.
 */
const WINDOW_BLOCKS = 250_000n;

export const protocolCursorKey = (chainId: number, address: string) => `stats:${chainId}:${address.toLowerCase()}`;

export interface ProtocolStream {
  key: string;
  address: `0x${string}`;
  kind: "ledger" | "factory";
  startBlock: bigint;
}

/** The logs the network-wide numbers come from: the ledger's `Settled` and every release's factory `VaultCreated` */
export function protocolStreams(deployment: Deployment): ProtocolStream[] {
  const ledger = deployment.contracts.invoiceLedger;
  return [
    { key: protocolCursorKey(deployment.chainId, ledger), address: ledger, kind: "ledger", startBlock: BigInt(deployment.startBlock) },
    ...vaultFactories(deployment.chainId).map((f) => ({ key: protocolCursorKey(deployment.chainId, f.factory), address: f.factory, kind: "factory" as const, startBlock: f.startBlock })),
  ];
}

export interface ProtocolSyncReport {
  head: bigint;
  streams: { address: string; kind: "ledger" | "factory"; from: bigint; to: bigint; events: number }[];
}

/**
 * Reads the network's own history (every settlement on the ledger, every Vault a factory made) from each contract's deployment
 * block into the event mirror, one bounded window per stream per call, with its own cursors. The ledger mirror that follows known
 * invoices starts at the earliest of them and is not a network history; this one is, and the public stats read it. Idempotent.
 */
export async function syncProtocolEvents(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  opts: { toBlock?: bigint; maxBlocks?: bigint } = {},
): Promise<ProtocolSyncReport> {
  const head = opts.toBlock ?? (await client.getBlockNumber());
  const window = opts.maxBlocks ?? WINDOW_BLOCKS;
  const report: ProtocolSyncReport = { head, streams: [] };
  for (const stream of protocolStreams(deployment)) {
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, stream.key));
    const from = cursor ? cursor.block + 1n : stream.startBlock;
    if (from > head) {
      report.streams.push({ address: stream.address, kind: stream.kind, from, to: from - 1n, events: 0 });
      continue;
    }
    const to = from + window - 1n < head ? from + window - 1n : head;
    const { logs, scannedTo } =
      stream.kind === "ledger"
        ? await scanLogs(client, { address: stream.address, events: SETTLED, fromBlock: from, toBlock: to, concurrency: CONCURRENCY })
        : await scanLogs(client, { address: stream.address, events: VAULT_CREATED, fromBlock: from, toBlock: to, concurrency: CONCURRENCY });
    await db.transaction(async (tx) => {
      await storeEvents(tx, client, deployment.chainId, logs);
      await tx
        .insert(syncCursors)
        .values({ key: stream.key, chainId: deployment.chainId, block: scannedTo })
        .onConflictDoUpdate({ target: syncCursors.key, set: { block: scannedTo, updatedAt: sql`now()` } });
    });
    report.streams.push({ address: stream.address, kind: stream.kind, from, to: scannedTo, events: logs.length });
  }
  return report;
}
