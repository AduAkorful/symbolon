import { isNotNull, sql } from "drizzle-orm";
import type { PublicClient } from "viem";

import { symbolonContracts } from "@symbolon/chain";
import {
  backfillDeposits,
  ensureVaultBlock,
  ledgerHeadKey,
  refreshInboxMirror,
  syncLedger,
  syncProtocolEvents,
  syncVault,
  type SyncReport,
} from "@symbolon/core";
import { businesses, syncCursors, type Database } from "@symbolon/db";
import type { AppConfig } from "@symbolon/config";

import { deleteExpiredMessages } from "./ask-expiry.js";
import { backfillBlockTimes } from "./block-times.js";

/** One tick reads at most this much of the ledger. The next tick continues from the cursor. */
const LEDGER_WINDOW_BLOCKS = 1_000_000n;
/** One tick reads at most this much of one Vault. */
const VAULT_WINDOW_BLOCKS = 100_000n;
/** No new log range starts after this. A stuck endpoint cannot hold the tick open past it. */
const TICK_BUDGET_MS = 60_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface IndexerReport {
  ledger: SyncReport | { error: string };
  protocol: Awaited<ReturnType<typeof syncProtocolEvents>> | { error: string };
  vaults: { advanced: number; left: number; failed: string[] } | { error: string };
  behindBlocks: bigint;
  done: boolean;
}

/**
 * One indexer tick: ledger, network history, each Vault, deposits, block times, inbox trust, old Ask messages.
 * Each scan keeps its own cursor and moves one window. The Next app does not call this.
 */
export async function runIndexerTick(db: Database, client: PublicClient, cfg: AppConfig, opts: { budgetMs?: number; now?: () => number } = {}): Promise<IndexerReport> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? TICK_BUDGET_MS);
  let behindBlocks = 0n;
  const behind = (head: bigint, to: bigint) => {
    if (head > to && head - to > behindBlocks) behindBlocks = head - to;
  };
  const late = () => now() >= deadline;

  let ledger: IndexerReport["ledger"];
  try {
    ledger = await syncLedger(db, client, symbolonContracts(client, cfg.deployment), cfg.deployment, { maxBlocks: LEDGER_WINDOW_BLOCKS, deadline });
    behind(ledger.head, ledger.to);
    await db
      .insert(syncCursors)
      .values({ key: ledgerHeadKey(cfg.chainId, cfg.deployment.contracts.invoiceLedger), chainId: cfg.chainId, block: ledger.head })
      .onConflictDoUpdate({
        target: syncCursors.key,
        set: { block: ledger.head, updatedAt: sql`now()` },
      });
  } catch (e) {
    ledger = { error: message(e) };
  }

  let protocol: IndexerReport["protocol"];
  if (late()) protocol = { error: "skipped: out of time" };
  else {
    try {
      protocol = await syncProtocolEvents(db, client, cfg.deployment, { deadline });
      for (const s of protocol.streams) behind(protocol.head, s.to);
    } catch (e) {
      protocol = { error: message(e) };
    }
  }

  let vaults: IndexerReport["vaults"];
  try {
    const rows = await db.select({ id: businesses.id, vault: businesses.vault }).from(businesses).where(isNotNull(businesses.vault));
    let advanced = 0;
    let left = 0;
    const failed: string[] = [];
    for (const row of rows) {
      if (late()) {
        left++;
        continue;
      }
      const vault = row.vault as `0x${string}`;
      try {
        const fromBlock = await ensureVaultBlock(db, client, cfg.deployment, row.id, vault);
        const r = await syncVault(db, client, cfg.deployment, vault, { fromBlock, maxBlocks: VAULT_WINDOW_BLOCKS, deadline });
        behind(r.head, r.to);
        await backfillDeposits(db, client, cfg.deployment, row.id, vault);
        await backfillBlockTimes(db, client, vault);
        await refreshInboxMirror(db, client, cfg.deployment, { businessId: row.id });
        advanced++;
      } catch (e) {
        failed.push(`${row.id}: ${message(e)}`);
      }
    }
    vaults = { advanced, left, failed };
  } catch (e) {
    vaults = { error: message(e) };
  }

  if (!late()) {
    try {
      await deleteExpiredMessages(db);
    } catch (e) {
      console.error("ask expiry failed", message(e));
    }
  }

  const vaultsLeft = "left" in vaults ? vaults.left : 0;
  const errors = [ledger, protocol, vaults].filter((r) => r !== null && typeof r === "object" && "error" in r).length;
  const failedVaults = "failed" in vaults ? vaults.failed.length : 0;
  return {
    ledger,
    protocol,
    vaults,
    behindBlocks,
    done: behindBlocks === 0n && vaultsLeft === 0 && errors === 0 && failedVaults === 0,
  };
}
