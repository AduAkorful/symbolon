import "server-only";
import { isNotNull, sql } from "drizzle-orm";
import type { PublicClient } from "viem";
import { syncLedger, syncProtocolEvents, syncVault } from "@symbolon/core";
import { businesses, syncCursors, type Database } from "@symbolon/db";
import { symbolonContracts } from "@symbolon/chain";
import { deleteExpiredMessages } from "./ask-store";
import { ensureVaultBlock } from "./business";
import type { getConfig } from "./config";

type Config = ReturnType<typeof getConfig>;

/**
 * The scheduled sync's time limits (17 Oct). The route may run 120 s on Vercel; a run that read until it was done took longer
 * than that whenever the mirror was behind (or several monitors called at once and the public RPCs slowed everyone down), so
 * Vercel killed it with FUNCTION_INVOCATION_TIMEOUT, every check failed, and the ledger mirror saved nothing because it saves
 * once, at the end of its scan. Now:
 *
 * - no new log range is started after `BUDGET_MS`; each scan saves how far it got, and the next run carries on from there,
 * - a step still waiting at `HARD_STOP_MS` (one RPC call can take ~35 s across the pool's endpoints) is left behind and the run
 *   answers anyway: every step writes in its own transaction, so nothing half-done is kept,
 * - one run at a time: a second call while one is running answers at once instead of competing for the same rate limits.
 */
export const BUDGET_MS = 50_000;
export const HARD_STOP_MS = 95_000;
/** Longer than any run can last (maxDuration 120 s), so a run killed before it let go never blocks the next one for long */
const LEASE_SECONDS = 130;
const VAULT_WINDOW_BLOCKS = 100_000n;
/** The ledger mirror reads at most this many blocks a run (it had no bound, so far behind it could never finish in time) */
const LEDGER_WINDOW_BLOCKS = 1_000_000n;

const leaseKey = (chainId: number) => `lease:cron-sync:${chainId}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Takes the run lease, or returns false when another run holds it (taken less than LEASE_SECONDS ago and not let go) */
export async function takeSyncLease(db: Database, chainId: number): Promise<boolean> {
  const rows = await db
    .insert(syncCursors)
    .values({ key: leaseKey(chainId), chainId, block: 0n })
    .onConflictDoUpdate({
      target: syncCursors.key,
      set: { updatedAt: sql`now()` },
      setWhere: sql`${syncCursors.updatedAt} < now() - make_interval(secs => ${LEASE_SECONDS})`,
    })
    .returning({ key: syncCursors.key });
  return rows.length > 0;
}

export async function releaseSyncLease(db: Database, chainId: number): Promise<void> {
  await db.update(syncCursors).set({ updatedAt: sql`to_timestamp(0)` }).where(sql`${syncCursors.key} = ${leaseKey(chainId)}`);
}

export interface CronSyncOptions {
  budgetMs?: number;
  hardStopMs?: number;
  now?: () => number;
}

/** One scheduled sync: the ledger mirror, the network history, each Vault's history, old Steward conversations; always within the limits above */
export async function runCronSync(db: Database, client: PublicClient, cfg: Config, opts: CronSyncOptions = {}) {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + (opts.budgetMs ?? BUDGET_MS);
  const hardStop = startedAt + (opts.hardStopMs ?? HARD_STOP_MS);
  const timings: Record<string, number> = {};
  let behindBlocks = 0n;
  const behind = (head: bigint, to: bigint) => {
    if (head > to && head - to > behindBlocks) behindBlocks = head - to;
  };

  /** A step's result, or an error naming it when it is still running at the hard stop (it is not awaited further) */
  const step = async <T>(name: string, work: () => Promise<T>): Promise<T | { error: string }> => {
    const t0 = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ error: string }>((resolve) => {
      timer = setTimeout(() => resolve({ error: `${name} was still running at the time limit; the next run carries on` }), Math.max(0, hardStop - now()));
    });
    try {
      return await Promise.race([work().catch((e: unknown) => ({ error: message(e) })), late]);
    } finally {
      clearTimeout(timer);
      timings[name] = now() - t0;
    }
  };

  const ledger = await step("ledger", () =>
    syncLedger(db, client, symbolonContracts(client, cfg.deployment), cfg.deployment, { maxBlocks: LEDGER_WINDOW_BLOCKS, deadline }),
  );
  if (!("error" in ledger)) behind(ledger.head, ledger.to);

  // the network history behind the landing page numbers fills in a window at a time; a failure there is reported, and never hides the ledger result
  const protocol = now() < deadline ? await step("protocol", () => syncProtocolEvents(db, client, cfg.deployment, { deadline })) : { error: "skipped: out of time" };
  if (!("error" in protocol)) for (const s of protocol.streams) behind(protocol.head, s.to);

  // each business's Vault history (the Activity timeline) moves forward one window per Vault, so a Steward run or a page never has to catch up
  const vaults = await step("vaults", async () => {
    const rows = await db.select({ id: businesses.id, vault: businesses.vault }).from(businesses).where(isNotNull(businesses.vault));
    let advanced = 0;
    let left = 0;
    const failed: string[] = [];
    for (const row of rows) {
      if (now() >= deadline) {
        left++;
        continue;
      }
      try {
        const vault = row.vault as `0x${string}`;
        const r = await syncVault(db, client, cfg.deployment, vault, { fromBlock: await ensureVaultBlock(db, client, cfg.deployment, row.id, vault), maxBlocks: VAULT_WINDOW_BLOCKS, deadline });
        behind(r.head, r.to);
        advanced++;
      } catch (e) {
        failed.push(`${row.id}: ${message(e)}`);
      }
    }
    return { advanced, left, failed };
  });

  // conversations with the Steward are kept for 30 days (plan 05zf); a failure here is reported and hides nothing
  const askExpired = now() < hardStop ? await step("askExpired", () => deleteExpiredMessages(db)) : { error: "skipped: out of time" };

  const vaultsLeft = "left" in vaults ? vaults.left : 0;
  const errors = [ledger, protocol, vaults, askExpired].filter((r) => r !== null && typeof r === "object" && "error" in r).length;
  return {
    ...("error" in ledger ? { ledgerError: ledger.error } : ledger),
    protocol,
    vaults,
    askExpired,
    /** Nothing left to read: every mirror is at the head it saw and no step failed or ran out of time */
    done: behindBlocks === 0n && vaultsLeft === 0 && errors === 0,
    behindBlocks,
    elapsedMs: now() - startedAt,
    timings,
  };
}
