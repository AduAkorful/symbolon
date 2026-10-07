import { and, eq, inArray, sql } from "drizzle-orm";
import { getAbiItem, type Hex, type PublicClient } from "viem";

import { blockAtOrBefore, invoiceLedgerAbi, invoiceStatus, scanLogs, symbolonVaultAbi, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import { chainEvents, invoices, syncCursors, type Database } from "@symbolon/db";
import { notifyVendor } from "./domain-notifications.js";

const LEDGER_EVENTS = [
  getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" }),
  getAbiItem({ abi: invoiceLedgerAbi, name: "Cancelled" }),
  getAbiItem({ abi: invoiceLedgerAbi, name: "CreditNoteApplied" }),
] as const;

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)));

export interface SyncReport {
  from: bigint;
  to: bigint;
  /** The chain's newest block when this run started; `to < head` means the mirror is still catching up */
  head: bigint;
  events: number;
  invoicesUpdated: number;
}

/** Log requests in flight at once during a catch-up. Public RPCs rate-limit log queries, so this stays small. */
const SYNC_CONCURRENCY = 2;

async function resolveBlockTimes(
  client: PublicClient,
  blockNumbers: bigint[],
  cache: Map<bigint, Date> = new Map(),
): Promise<Map<bigint, Date>> {
  const missing = [...new Set(blockNumbers)].filter((b) => !cache.has(b));
  await Promise.all(
    missing.map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: bn });
        cache.set(bn, new Date(Number(block.timestamp) * 1000));
      } catch {
        // Leave unpopulated if getBlock fails or client doesn't support it
      }
    }),
  );
  return cache;
}


export interface EventToStore {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  address: string;
  eventName: string;
  args: unknown;
}

/** Writes chain events into the mirror (idempotent: the same log twice is one row; a known block time is never lost) */
export async function storeEvents(
  db: Pick<Database, "insert">,
  client: PublicClient,
  chainId: number,
  logs: readonly EventToStore[],
): Promise<void> {
  if (!logs.length) return;
  const blockTimes = await resolveBlockTimes(client, logs.map((l) => l.blockNumber));
  await db
    .insert(chainEvents)
    .values(
      logs.map((l) => ({
        chainId,
        txHash: l.transactionHash.toLowerCase(),
        logIndex: l.logIndex,
        blockNumber: l.blockNumber,
        blockTime: blockTimes.get(l.blockNumber),
        address: l.address.toLowerCase(),
        eventName: l.eventName,
        args: json(l.args),
      })),
    )
    .onConflictDoUpdate({
      target: [chainEvents.chainId, chainEvents.txHash, chainEvents.logIndex],
      set: { blockTime: sql`coalesce(chain_events.block_time, excluded.block_time)` },
    });
}

/** Margin before the earliest invoice, for a date-only issue time and clock differences between a signer and the chain */
const FIRST_BLOCK_MARGIN_SECONDS = 86_400n;

/**
 * Where a ledger mirror with no cursor should begin. The mirror exists to keep known invoices current, and no invoice is
 * paid before it was issued or received, so reading starts at the earliest such time (minus a day) instead of at the
 * deployment's first block. `null` means no invoice is known: there is nothing to follow yet, so the caller starts at the
 * head. A payment older than this start is found when its invoice is opened (see `collectInvoiceHistory`).
 */
export async function firstLedgerBlock(db: Database, client: PublicClient, deployment: Deployment, head: bigint): Promise<bigint | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`min(least(${invoices.issuedAt}, ${invoices.receivedAt}))` })
    .from(invoices)
    .where(and(eq(invoices.chainId, deployment.chainId), sql`lower(${invoices.ledger}) = ${deployment.contracts.invoiceLedger.toLowerCase()}`));
  if (!row?.at) return null;
  const seconds = BigInt(Math.floor(new Date(row.at).getTime() / 1000));
  return blockAtOrBefore(client, seconds - FIRST_BLOCK_MARGIN_SECONDS, { lo: deployment.startBlock, hi: head });
}

/**
 * Pulls the ledger's events since the last cursor, stores them, and refreshes every affected invoice from the ledger's
 * own state (the chain decides what "paid" means; events only say what to re-read). Idempotent and resumable.
 */
export async function syncLedger(
  db: Database,
  client: PublicClient,
  contracts: SymbolonContracts,
  deployment: Deployment,
  opts: { toBlock?: bigint; maxBlocks?: bigint } = {},
): Promise<SyncReport> {
  const key = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
  const head = opts.toBlock ?? (await client.getBlockNumber());
  let from: bigint;
  if (cursor) from = cursor.block + 1n;
  else {
    const first = await firstLedgerBlock(db, client, deployment, head);
    if (first === null) {
      // no invoice to follow: start at the head, and remember it so the next run doesn't look again
      await db
        .insert(syncCursors)
        .values({ key, chainId: deployment.chainId, block: head })
        .onConflictDoNothing();
      return { from: head + 1n, to: head, head, events: 0, invoicesUpdated: 0 };
    }
    from = first;
  }
  // `maxBlocks` bounds one run; the cursor makes the next run continue where this one stopped
  const to = opts.maxBlocks !== undefined && from + opts.maxBlocks - 1n < head ? from + opts.maxBlocks - 1n : head;
  if (from > to) return { from, to, head, events: 0, invoicesUpdated: 0 };

  const { logs, scannedTo } = await scanLogs(client, {
    address: deployment.contracts.invoiceLedger,
    events: LEDGER_EVENTS,
    fromBlock: from,
    toBlock: to,
    concurrency: SYNC_CONCURRENCY,
  });
  const touched = [...new Set(logs.map((l) => (l.args as { fingerprint: Hex }).fingerprint.toLowerCase()))];
  const known = touched.length
    ? await db.select({ fp: invoices.fingerprint }).from(invoices).where(inArray(invoices.fingerprint, touched))
    : [];
  const states = await Promise.all(known.map(async ({ fp }) => [fp, await invoiceStatus(contracts, fp as Hex)] as const));

  await db.transaction(async (tx) => {
    await storeEvents(tx, client, deployment.chainId, logs);
    for (const [fp, s] of states) {
      const status = s.cancelled ? "cancelled" : s.paid ? "paid" : s.credited > 0n ? "partially_paid" : undefined;
      await tx
        .update(invoices)
        .set({ credited: s.credited, syncedBlock: scannedTo, ...(status ? { status, holdSource: null, holdKind: null } : {}) })
        .where(eq(invoices.fingerprint, fp));
    }
    for (const log of logs) {
      if (log.eventName !== "Settled" && log.eventName !== "Cancelled") continue;
      const fp = (log.args as { fingerprint: Hex }).fingerprint.toLowerCase();
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.fingerprint, fp));
      if (invoice) await notifyVendor(tx, invoice.seal, { kind: log.eventName === "Settled" ? "invoice_paid" : "invoice_cancelled",
        subject: fp, body: { invoiceNumber: invoice.invoiceNumber, txHash: log.transactionHash, partial: invoice.status !== "paid" },
        dedupeKey: `${log.eventName === "Settled" ? "paid" : "cancelled"}:${fp}:${log.transactionHash.toLowerCase()}` });
    }
    await tx
      .insert(syncCursors)
      .values({ key, chainId: deployment.chainId, block: scannedTo })
      .onConflictDoUpdate({ target: syncCursors.key, set: { block: scannedTo, updatedAt: sql`now()` } });
  });
  return { from, to: scannedTo, head, events: logs.length, invoicesUpdated: states.length };
}

/** Every event a Vault emits, for the audit trail (spec §11): payments, payee and Seal changes, policy, anchors */
const VAULT_EVENTS = symbolonVaultAbi.filter((i): i is Extract<(typeof symbolonVaultAbi)[number], { type: "event" }> => i.type === "event");

/**
 * Stores a Vault's events since its cursor (`vault:<chain>:<address>`), starting from `fromBlock` the first time
 * (the Vault's creation block or the deployment's startBlock). Idempotent and resumable.
 */
export async function syncVault(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  vault: `0x${string}`,
  opts: { fromBlock?: bigint; toBlock?: bigint } = {},
): Promise<SyncReport> {
  const key = `vault:${deployment.chainId}:${vault.toLowerCase()}`;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
  const from = cursor ? cursor.block + 1n : (opts.fromBlock ?? deployment.startBlock);
  const to = opts.toBlock ?? (await client.getBlockNumber());
  if (from > to) return { from, to, head: to, events: 0, invoicesUpdated: 0 };

  const { logs, scannedTo } = await scanLogs(client, { address: vault, events: VAULT_EVENTS, fromBlock: from, toBlock: to, concurrency: SYNC_CONCURRENCY });
  await db.transaction(async (tx) => {
    await storeEvents(tx, client, deployment.chainId, logs);
    await tx
      .insert(syncCursors)
      .values({ key, chainId: deployment.chainId, block: scannedTo })
      .onConflictDoUpdate({ target: syncCursors.key, set: { block: scannedTo, updatedAt: sql`now()` } });
  });
  return { from, to: scannedTo, head: to, events: logs.length, invoicesUpdated: 0 };
}
