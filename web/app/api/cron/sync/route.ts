import { NextResponse } from "next/server";
import { isNotNull } from "drizzle-orm";
import { syncLedger, syncProtocolEvents, syncVault } from "@symbolon/core";
import { businesses } from "@symbolon/db";
import { symbolonContracts } from "@symbolon/chain";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { refuseUnlessScheduler } from "@/lib/server/cron-auth";
import { deleteExpiredMessages } from "@/lib/server/ask-store";
import { ensureVaultBlock } from "@/lib/server/business";
import { getDb } from "@/lib/server/db";

// one window of network history (about 30 s) after the ledger sync
export const maxDuration = 120;

const VAULT_WINDOW_BLOCKS = 100_000n;

async function syncBusinessVaults(db: Awaited<ReturnType<typeof getDb>>, client: ReturnType<typeof getClient>, cfg: ReturnType<typeof getConfig>) {
  const rows = await db.select({ id: businesses.id, vault: businesses.vault }).from(businesses).where(isNotNull(businesses.vault));
  let advanced = 0;
  const failed: string[] = [];
  for (const row of rows) {
    try {
      const vault = row.vault as `0x${string}`;
      await syncVault(db, client, cfg.deployment, vault, { fromBlock: await ensureVaultBlock(db, client, cfg.deployment, row.id, vault), maxBlocks: VAULT_WINDOW_BLOCKS });
      advanced++;
    } catch (e) {
      failed.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { advanced, failed };
}

async function run(request: Request) {
  const refused = refuseUnlessScheduler(request, "Ledger syncing");
  if (refused) return refused;
  const cfg = getConfig();
  const client = getClient();
  const db = await getDb();
  const report = await syncLedger(db, client, symbolonContracts(client, cfg.deployment), cfg.deployment);
  // the network history behind the landing page numbers fills in a window at a time; a failure there is reported, and never hides the ledger result
  const protocol = await syncProtocolEvents(db, client, cfg.deployment).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  // each business's Vault history (the Activity timeline) moves forward one window per Vault, so a Steward run or a page never has to catch up
  const vaults = await syncBusinessVaults(db, client, cfg).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  // conversations with the Steward are kept for 30 days (plan 05zf); a failure here is reported and hides nothing
  const askExpired = await deleteExpiredMessages(db).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return new NextResponse(JSON.stringify({ ...report, protocol, vaults, askExpired }, (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value), { headers: { "content-type": "application/json" } });
}

// POST for GitHub Actions and cron services; GET because Vercel Cron only sends GET (same secret, same work)
export const POST = run;
export const GET = run;
