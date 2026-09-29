import "server-only";

import { and, eq } from "drizzle-orm";
import { syncLedger, type SyncReport } from "@symbolon/core";
import { symbolonContracts } from "@symbolon/chain";
import { syncCursors, type Database } from "@symbolon/db";
import type { PublicClient } from "viem";
import type { ChainSettings } from "./business";

const FRESH_FOR_MS = 30_000;
let running: Promise<SyncReport> | undefined;

function keyFor(cfg: ChainSettings) {
  return `ledger:${cfg.chainId}:${cfg.deployment.contracts.invoiceLedger.toLowerCase()}`;
}

/** Refreshes the ledger mirror at most once per 30 seconds per app process. */
export async function ensureFresh(db: Database, client: PublicClient, cfg: ChainSettings): Promise<{ ok: true; report?: SyncReport } | { ok: false; reason: string }> {
  const [cursor] = await db.select().from(syncCursors).where(and(eq(syncCursors.key, keyFor(cfg)), eq(syncCursors.chainId, cfg.chainId))).limit(1);
  if (cursor && Date.now() - cursor.updatedAt.getTime() < FRESH_FOR_MS) return { ok: true };
  if (!running) {
    running = syncLedger(db, client, symbolonContracts(client, cfg.deployment), cfg.deployment);
  }
  try {
    return { ok: true, report: await running };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The ledger could not be synced." };
  } finally {
    running = undefined;
  }
}

export function syncKey(cfg: ChainSettings) {
  return keyFor(cfg);
}
