import { isNotNull } from "drizzle-orm";
import { getAddress } from "viem";

import { businesses } from "@symbolon/db";

import { anchorDecisions } from "./anchor.js";
import { releaseDue } from "./series.js";
import { runSteward, type StewardEnv } from "./steward.js";
import { syncLedger, syncVault } from "./sync.js";
import { DEFAULT_TREASURY, runTreasury, type TreasuryOptions } from "./treasury.js";

export interface CycleReport {
  synced: { events: number; invoicesUpdated: number };
  released: number;
  businesses: { id: string; decisions: number; treasury: string; anchored?: number; error?: string }[];
}

/**
 * One tick of the scheduled job: pull chain state, release due recurring invoices, then for every business with a
 * Vault run the Steward, the treasury and (every `anchorEvery` ticks) decision anchoring. One business failing never
 * stops the others; the error is reported. Chain sync runs first so every decision sees fresh ledger state.
 */
export async function runCycle(
  env: StewardEnv,
  opts: { now?: Date; anchor?: boolean; treasury?: TreasuryOptions } = {},
): Promise<CycleReport> {
  const synced = await syncLedger(env.db, env.client, env.contracts, env.deployment);
  const released = await releaseDue(env.db, { chainId: env.deployment.chainId, ledger: env.deployment.contracts.invoiceLedger }, opts.now ?? new Date());
  const report: CycleReport = { synced: { events: synced.events, invoicesUpdated: synced.invoicesUpdated }, released: released.length, businesses: [] };

  const all = await env.db.select().from(businesses).where(isNotNull(businesses.vault));
  for (const biz of all) {
    try {
      await syncVault(env.db, env.client, env.deployment, getAddress(biz.vault!));
      const decisions = await runSteward(env, biz.id);
      const treasury = await runTreasury(env, biz.id, opts.treasury ?? DEFAULT_TREASURY);
      const anchored = opts.anchor ? await anchorDecisions(env.db, biz.id, env.wallet) : undefined;
      report.businesses.push({ id: biz.id, decisions: decisions.length, treasury: treasury.action, ...(anchored ? { anchored: anchored.count } : {}) });
    } catch (error) {
      report.businesses.push({ id: biz.id, decisions: 0, treasury: "none", error: String((error as Error).message ?? error).slice(0, 300) });
    }
  }
  return report;
}
