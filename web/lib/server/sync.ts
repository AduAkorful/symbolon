import "server-only";

import { and, eq } from "drizzle-orm";
import { syncLedger, type SyncReport } from "@symbolon/core";
import { symbolonContracts, type SymbolonContracts } from "@symbolon/chain";
import { syncCursors, type Database } from "@symbolon/db";
import type { PublicClient } from "viem";
import type { ChainSettings } from "./business";

const FRESH_FOR_MS = 30_000;

/** One sync run reads at most this many blocks from the cursor; the next run continues from where it stopped (plan 05za, A3) */
export const SYNC_WINDOW_BLOCKS = 200_000n;

/** A page waits this long for the sync; after that it draws from the mirror and says the mirror is catching up */
export const PAGE_SYNC_DEADLINE_MS = 5_000;

let running: Promise<SyncReport> | undefined;
/** How many blocks the last finished run left unread; the freshness shortcut is off while this is above zero */
let behind = 0n;

function keyFor(cfg: ChainSettings) {
  return `ledger:${cfg.chainId}:${cfg.deployment.contracts.invoiceLedger.toLowerCase()}`;
}

export type SyncState =
  | { ok: true; catchingUp: false }
  | { ok: true; catchingUp: true; behind: bigint | null }
  | { ok: false; reason: string };

/** How the most recent sync in this process ended: what a page says when it did not wait for one itself */
let last: SyncState | null = null;
export const lastSyncState = (): SyncState | null => last;

function start(db: Database, client: PublicClient, cfg: ChainSettings, contracts?: SymbolonContracts): Promise<SyncReport> {
  if (!running) {
    let run: Promise<SyncReport> | undefined;
    run = (async () => {
      const startedAt = Date.now();
      try {
        const report = await syncLedger(db, client, contracts ?? symbolonContracts(client, cfg.deployment), cfg.deployment, { maxBlocks: SYNC_WINDOW_BLOCKS });
        behind = report.head > report.to ? report.head - report.to : 0n;
        // one line per run, so a slow or stuck sync is visible in the logs
        console.info(`ledger sync: blocks ${report.from}-${report.to} of ${report.head}, ${report.events} events, ${Date.now() - startedAt} ms`);
        return report;
      } finally {
        if (running === run) running = undefined;
      }
    })();
    running = run;
  }
  return running;
}

const sleep = (ms: number) => new Promise<"late">((resolve) => setTimeout(() => resolve("late"), ms));

/**
 * Brings the ledger mirror forward by one bounded window, at most once per 30 seconds per app process, and never holds a
 * page past `deadlineMs`: a sync that is still reading carries on in the background (the cursor moves only when a window is
 * saved, so nothing is half-written) and the caller draws from what the mirror has, saying it is catching up.
 */
export async function ensureFresh(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  opts: { deadlineMs?: number; force?: boolean } = {},
): Promise<SyncState> {
  const remember = (state: SyncState) => (last = state);
  if (!opts.force && behind === 0n) {
    const [cursor] = await db.select().from(syncCursors).where(and(eq(syncCursors.key, keyFor(cfg)), eq(syncCursors.chainId, cfg.chainId))).limit(1);
    if (cursor && Date.now() - cursor.updatedAt.getTime() < FRESH_FOR_MS) return remember({ ok: true, catchingUp: false });
  }
  const pending = start(db, client, cfg);
  pending.catch((error) => {
    console.error("ledger sync failed", error);
    remember({ ok: false, reason: error instanceof Error ? error.message : "The ledger could not be synced." });
  });
  try {
    const result = await Promise.race([pending, sleep(opts.deadlineMs ?? PAGE_SYNC_DEADLINE_MS)]);
    if (result === "late") return remember({ ok: true, catchingUp: true, behind: null });
    return remember(result.head > result.to ? { ok: true, catchingUp: true, behind: result.head - result.to } : { ok: true, catchingUp: false });
  } catch (error) {
    return remember({ ok: false, reason: error instanceof Error ? error.message : "The ledger could not be synced." });
  }
}

/**
 * For pages (plan 05zd F4): bring the ledger copy forward after the response has gone out, so the page never waits on Arc for it.
 * The page draws from the database and from how the last sync ended (`lastSyncState`); the next view, or the scheduled sync, sees
 * what this found.
 */
export async function refreshLedgerAfterResponse(db: Database, client: PublicClient, cfg: ChainSettings): Promise<void> {
  await ensureFresh(db, client, cfg, { deadlineMs: 60_000 });
}

/**
 * Reads window after window until the mirror reaches the chain's head, for actions whose answer would be wrong from a
 * partial copy (an accounting re-sync). Gives up at the deadline and says so; it never returns a partial copy as current.
 */
export async function syncToHead(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  opts: { deadlineMs?: number; contracts?: SymbolonContracts } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const until = Date.now() + (opts.deadlineMs ?? 90_000);
  while (Date.now() < until) {
    let report: SyncReport;
    try {
      report = await start(db, client, cfg, opts.contracts);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "The ledger could not be synced." };
    }
    if (report.head <= report.to) return { ok: true };
  }
  return { ok: false, reason: "The ledger copy is still catching up with Arc. Try again in a minute." };
}

export function syncKey(cfg: ChainSettings) {
  return keyFor(cfg);
}
