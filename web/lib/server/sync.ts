import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { ledgerCursorKey, ledgerHeadKey } from "@symbolon/core";
import { syncCursors, type Database } from "@symbolon/db";

import type { ChainSettings } from "./business";

export type SyncState =
  | { ok: true; catchingUp: false }
  | { ok: true; catchingUp: true; behind: bigint | null }
  | { ok: false; reason: string };

/**
 * What the worker has stored. Pages and accounting read this. They do not scan.
 * Behind means the ledger cursor is short of the head the worker last wrote.
 */
export async function readLedgerMirror(db: Database, cfg: ChainSettings): Promise<SyncState> {
  const ledgerKey = ledgerCursorKey(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const headKey = ledgerHeadKey(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const rows = await db.select().from(syncCursors).where(and(eq(syncCursors.chainId, cfg.chainId), inArray(syncCursors.key, [ledgerKey, headKey])));
  const ledger = rows.find((r) => r.key === ledgerKey);
  const head = rows.find((r) => r.key === headKey);
  if (!head || !ledger) return { ok: true, catchingUp: true, behind: null };
  if (ledger.block < head.block) return { ok: true, catchingUp: true, behind: head.block - ledger.block };
  return { ok: true, catchingUp: false };
}
