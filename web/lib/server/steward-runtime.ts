import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { formatUnits, getAddress, type Address, type PublicClient } from "viem";

import { reserveYield, symbolonContracts } from "@symbolon/chain";
import { anchorDecisions, expireOffers, notifyBusiness, releaseDue, runLending, runSteward, runTreasury, syncVault, type StewardEnv } from "@symbolon/core";
import { businesses, decisionAnchors, decisions, stewardRuns, type Database } from "@symbolon/db";
import { CircleStewardWallet, createCircleClient, DEFAULT_EARLY_PAY, provisionStewardWallet, type EarlyPayProgram, type StewardWallet } from "@symbolon/steward";

import { ensureVaultBlock, type ChainSettings } from "./business";
import { AuthError } from "./errors";
import { getStewardModel } from "./steward-model";
import { ensureFresh } from "./sync";
import { notifyDueNotices } from "./due-notices";
import { notifyPayeesActive } from "./payee-active";
import { notPreparedPayment } from "./prepared-payment";
import { showMoney } from "../format";

/**
 * 0.01 native USDC (18 decimals on Arc) minimum fee balance.
 * A typical pay or anchor transaction on Arc costs ~0.0003 USDC (Fact 2 / S5).
 */
export const MIN_STEWARD_FEE_BALANCE = 10_000_000_000_000_000n;

/**
 * Lease timeout. A run's route is cut off at 120 s (`maxDuration`), so a run still "running" after 150 s was killed and will never
 * report; waiting five minutes left it on "Running" long after it had stopped (QA payment retest). Runs were being cut off at the
 * old 60 s and then shown as "Failed: previous lease expired" (QA retest 4).
 */
export const STEWARD_RUN_LEASE_MS = 150 * 1000;
/** Minimum decisions pending to anchor them in a scheduled run (plan 05p A10 / Q3) */
export const ANCHOR_BATCH_MIN = 5;
/** One run reads at most this much of a Vault's history, for at most this long (a few Arc log requests) */
const RUN_VAULT_WINDOW_BLOCKS = 20_000n;
const RUN_VAULT_SYNC_DEADLINE_MS = 8_000;

let circleClient: ReturnType<typeof createCircleClient> | undefined;

export interface StewardConfig extends ChainSettings {
  stewardCircle?: { apiKey: string; entitySecret: string; walletSetId?: string } | null;
}

export async function feeBalance(client: PublicClient, stewardWallet: string): Promise<bigint | null> {
  try {
    return await client.getBalance({ address: getAddress(stewardWallet) });
  } catch (err) {
    console.error("feeBalance read failed:", err);
    return null;
  }
}

export function formatFeeBalance(rawBalance: bigint | null): { formatted: string; raw: string | null } {
  if (rawBalance === null) return { formatted: "can't confirm", raw: null };
  const str = formatUnits(rawBalance, 18);
  // Show up to 4 decimal places
  const [whole, dec = ""] = str.split(".");
  const formatted = dec ? `${whole}.${dec.slice(0, 4)}` : whole;
  return { formatted: `${formatted} USDC`, raw: rawBalance.toString() };
}

/**
 * Resolves the business's Steward wallet from Circle and validates it against recorded and onchain facts (S3).
 * Returns undefined if Circle is not configured.
 */
export async function resolveStewardWallet(
  client: PublicClient,
  cfg: StewardConfig,
  business: { id: string; vault: string | null; stewardWallet: string | null },
): Promise<StewardWallet | undefined> {
  if (!cfg.stewardCircle) return undefined;
  if (!business.vault || !business.stewardWallet) return undefined;

  circleClient ??= createCircleClient(cfg.stewardCircle.apiKey, cfg.stewardCircle.entitySecret);
  const provisioned = await provisionStewardWallet(circleClient, {
    chainId: cfg.chainId,
    refId: business.id,
    ...(cfg.stewardCircle.walletSetId ? { walletSetId: cfg.stewardCircle.walletSetId } : {}),
  });

  if (getAddress(provisioned.address) !== getAddress(business.stewardWallet)) {
    throw new Error(`Steward wallet mismatch: Circle returned ${provisioned.address}, record has ${business.stewardWallet}`);
  }

  const contracts = symbolonContracts(client, cfg.deployment);
  const state = await contracts.lens.read.getVaultState([getAddress(business.vault)]);
  if (getAddress(state.steward) !== getAddress(provisioned.address)) {
    throw new Error(`Vault onchain steward ${state.steward} does not match provisioned wallet ${provisioned.address}`);
  }

  return new CircleStewardWallet(circleClient, provisioned.walletId, provisioned.address, client);
}

/** Builds the StewardEnv with per-business wallet resolution and live reserve yield (S8) */
export async function buildStewardEnv(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  business: typeof businesses.$inferSelect,
): Promise<StewardEnv> {
  const contracts = symbolonContracts(client, cfg.deployment);
  const vault = business.vault ? getAddress(business.vault) : null;

  let program: EarlyPayProgram = business.earlyPay?.enabled
    ? { enabled: true, minSpreadBps: business.earlyPay.minSpreadBps, cashCapBps: business.earlyPay.cashCapBps }
    : { ...DEFAULT_EARLY_PAY, enabled: false };

  let reserveYieldBps = 0;
  if (vault) {
    try {
      const status = await contracts.lens.read.reserveStatus([vault]);
      if (status.policy.enabled && status.entitled && status.usycTeller !== "0x0000000000000000000000000000000000000000") {
        const y = await reserveYield(client, status.usycTeller);
        reserveYieldBps = y.bps;
      }
    } catch (err) {
      console.warn("Reserve yield read failed; disabling Early Pay for this run:", err);
      program = { ...program, enabled: false };
      reserveYieldBps = 0;
    }
  }

  const model = getStewardModel() ?? undefined;

  return {
    db,
    client,
    contracts,
    deployment: cfg.deployment,
    program,
    bufferDays: business.bufferDays ?? 30,
    reserveYieldBps,
    model,
    walletFor: async (b) => resolveStewardWallet(client, cfg, b),
  };
}

/**
 * Runs a single Steward cycle for a business under a recorded lease (S6, S10, S11).
 */
export async function runForBusiness(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  businessId: string,
  trigger: "manual" | "schedule",
  startedBy?: string,
): Promise<typeof stewardRuns.$inferSelect> {
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "This business has no Vault yet.");

  // vendors whose payee waiting period has now passed are told (plan 05zj E, D11 a); one notice each, never fatal to a run
  await notifyPayeesActive(db, { businessId }).catch((e) => console.error("payee-active notices failed", e instanceof Error ? e.message : e));
  await notifyDueNotices(db, client, cfg, businessId);

  // Acquire lease
  let runId: string;
  try {
    const [inserted] = await db
      .insert(stewardRuns)
      .values({
        businessId,
        trigger,
        mode: b.stewardMode,
        status: "running",
        startedBy: startedBy ?? null,
      })
      .returning();
    runId = inserted!.id;
  } catch {
    // Unique collision on steward_runs_active_unique: check if previous lease has expired
    const [active] = await db
      .select()
      .from(stewardRuns)
      .where(and(eq(stewardRuns.businessId, businessId), eq(stewardRuns.status, "running")))
      .limit(1);

    if (active && Date.now() - active.startedAt.getTime() > STEWARD_RUN_LEASE_MS) {
      await db
        .update(stewardRuns)
        .set({ status: "failed", finishedAt: new Date(), error: "Previous lease expired" })
        .where(eq(stewardRuns.id, active.id));

      const [reinserted] = await db
        .insert(stewardRuns)
        .values({
          businessId,
          trigger,
          mode: b.stewardMode,
          status: "running",
          startedBy: startedBy ?? null,
        })
        .returning();
      runId = reinserted!.id;
    } else {
      throw new AuthError(409, "A Steward run is already in progress.");
    }
  }

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, cfg.deployment);

  try {
    await releaseDue(db, { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger }, new Date(), { businessId });
    await expireOffers(db, new Date());
    // S10: Short-circuit if Vault is paused
    const state = await contracts.lens.read.getVaultState([vault]);
    if (state.paused) {
      const [skipped] = await db
        .update(stewardRuns)
        .set({ status: "skipped_paused", finishedAt: new Date(), summary: { reason: "payments_paused" } })
        .where(eq(stewardRuns.id, runId))
        .returning();
      return skipped!;
    }

    // S5: Fee check in auto mode
    if (b.stewardMode === "auto") {
      if (!b.stewardWallet) {
        const [skipped] = await db
          .update(stewardRuns)
          .set({ status: "skipped_fees", finishedAt: new Date(), summary: { reason: "no_steward_wallet" }, error: "No Steward wallet provisioned" })
          .where(eq(stewardRuns.id, runId))
          .returning();
        await notifyRunFailure(db, businessId, skipped!);
        return skipped!;
      }
      const balance = await feeBalance(client, b.stewardWallet);
      if (balance === null || balance < MIN_STEWARD_FEE_BALANCE) {
        const [skipped] = await db
          .update(stewardRuns)
          .set({
            status: "skipped_fees",
            finishedAt: new Date(),
            summary: { reason: "insufficient_fees", balance: balance?.toString() ?? "0" },
            error: "Steward wallet fee balance is too low for autonomous execution",
          })
          .where(eq(stewardRuns.id, runId))
          .returning();
        await notifyRunFailure(db, businessId, skipped!);
        return skipped!;
      }
    }

    // Chain sync
    await ensureFresh(db, client, cfg);
    // The Vault's events only feed the Activity history; a pass decides from live reads. So here the copy moves forward by one
    // bounded window and a failure never fails the run (found 2026-10-08: a Vault far behind made every run scan to the head,
    // Arc's public network rate-limited it, nothing was saved, and every later run failed the same way). The scheduled sync
    // carries the rest.
    try {
      const vaultBlock = await ensureVaultBlock(db, client, cfg.deployment, businessId, vault);
      await Promise.race([
        syncVault(db, client, cfg.deployment, vault, { fromBlock: vaultBlock, maxBlocks: RUN_VAULT_WINDOW_BLOCKS }),
        new Promise<void>((resolve) => setTimeout(resolve, RUN_VAULT_SYNC_DEADLINE_MS)),
      ]);
    } catch (syncErr) {
      console.warn("Vault history sync failed; the pass goes on from live reads:", syncErr);
    }

    // Execute runSteward
    const env = await buildStewardEnv(db, client, cfg, b);
    const results = await runSteward(env, businessId);

    // T8: Treasury run after invoice pass, only when reserve is available
    let treasuryAction: string | null = null;
    try {
      const status = await contracts.lens.read.reserveStatus([vault]);
      if (status.usycTeller !== "0x0000000000000000000000000000000000000000") {
        const treasuryResult = await runTreasury(env, businessId);
        treasuryAction = treasuryResult.action;
      }
    } catch (treasuryErr) {
      console.warn("Treasury run failed; invoice pass succeeded:", treasuryErr);
    }
    // the lending reserve (plan 05zk) is its own pass: it does nothing for a Vault with no lending vault set
    try {
      const lendingResult = await runLending(env, businessId);
      // a reserve pass that did nothing ("none") must not hide the lending move this run made (QA R25-7: "Treasury action none"
      // on the run that took $58.20 out of lending); the amount is said too
      if (lendingResult.action !== "none") {
        const inputs = (lendingResult.record?.inputs ?? {}) as { simulated?: unknown; plan?: { assets?: unknown } };
        const raw = String((lendingResult.action === "redeem" ? inputs.simulated : undefined) ?? inputs.plan?.assets ?? "");
        const amount = /^\d+$/.test(raw) ? ` ${showMoney(formatUnits(BigInt(raw), 6), "USDC")}` : "";
        const lending = lendingResult.action === "redeem" ? `took${amount || " cash"} out of lending` : `moved${amount || " cash"} into lending`;
        treasuryAction = treasuryAction && treasuryAction !== "none" ? `${treasuryAction}; ${lending}` : lending;
      }
    } catch (lendingErr) {
      console.warn("Lending run failed; invoice pass succeeded:", lendingErr);
    }

    const outcomes: Record<string, number> = {};
    for (const r of results) {
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    }

    // decisions are anchored in batches by the scheduled run (QA retest 5, R5-8: the backlog only ever grew because nothing did)
    let anchored: number | null = null;
    if (trigger === "schedule") {
      try {
        anchored = await anchorWhenDue(db, client, cfg, b);
      } catch (anchorErr) {
        console.warn("Scheduled anchoring failed; the pass itself succeeded:", anchorErr);
      }
    }

    const summary = {
      invoicesConsidered: results.length,
      outcomes,
      treasuryAction,
      ...(anchored ? { anchored } : {}),
    };

    const [done] = await db
      .update(stewardRuns)
      .set({ status: "done", finishedAt: new Date(), summary })
      .where(eq(stewardRuns.id, runId))
      .returning();
    return done!;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Run failed";
    await db
      .update(stewardRuns)
      .set({ status: "failed", finishedAt: new Date(), error: errorMsg })
      .where(eq(stewardRuns.id, runId));
    await notifyRunFailure(db, businessId, { id: runId, error: errorMsg });
    throw error;
  }
}

async function notifyRunFailure(db: Database, businessId: string, run: { id: string; error: string | null }) {
  await notifyBusiness(db, businessId, { kind: "steward_run_failed", subject: run.id,
    body: { reason: run.error ?? "A Steward cycle needs attention." }, dedupeKey: `run:${run.id}` }, { roles: ["owner"] });
}

export async function lastRun(db: Database, businessId: string): Promise<typeof stewardRuns.$inferSelect | null> {
  const [row] = await db.select().from(stewardRuns).where(eq(stewardRuns.businessId, businessId)).orderBy(desc(stewardRuns.startedAt)).limit(1);
  return row ?? null;
}

/** The latest runs for a business, newest first (plan 05zl 1.5: the Steward page showed only the last one, so a run could seem to be missing) */
export async function listRuns(db: Database, businessId: string, limit = 10): Promise<(typeof stewardRuns.$inferSelect)[]> {
  return db.select().from(stewardRuns).where(eq(stewardRuns.businessId, businessId)).orderBy(desc(stewardRuns.startedAt)).limit(limit);
}

/**
 * The most recent run a scheduler started (an uptime monitor or cron calling `/api/cron/steward`), as stored. Whether the Steward
 * runs on its own is a fact about what calls it, so the screen says what the runs show and never claims a schedule (plan 05zj D14).
 */
export async function lastScheduledRun(db: Database, businessId: string): Promise<typeof stewardRuns.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(stewardRuns)
    .where(and(eq(stewardRuns.businessId, businessId), eq(stewardRuns.trigger, "schedule")))
    .orderBy(desc(stewardRuns.startedAt))
    .limit(1);
  return row ?? null;
}

export async function listRunDecisions(db: Database, businessId: string, limit = 20): Promise<(typeof decisions.$inferSelect)[]> {
  return db.select().from(decisions).where(and(eq(decisions.businessId, businessId), notPreparedPayment)).orderBy(desc(decisions.createdAt)).limit(limit);
}

/** Anchors the pending decisions when there are enough of them and the Steward wallet can pay the fee; the count anchored, or null */
async function anchorWhenDue(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  b: typeof businesses.$inferSelect,
): Promise<number | null> {
  if (!b.stewardWallet) return null;
  const done = await db.select({ leaves: decisionAnchors.leaves }).from(decisionAnchors).where(and(eq(decisionAnchors.businessId, b.id), isNotNull(decisionAnchors.txHash)));
  const anchoredSet = new Set(done.flatMap((a) => a.leaves));
  const all = await db.select({ hash: decisions.hash }).from(decisions).where(eq(decisions.businessId, b.id));
  if (all.filter((d) => !anchoredSet.has(d.hash)).length < ANCHOR_BATCH_MIN) return null;
  const balance = await feeBalance(client, b.stewardWallet);
  if (balance === null || balance < MIN_STEWARD_FEE_BALANCE) return null;
  const wallet = await resolveStewardWallet(client, cfg, b);
  if (!wallet) return null;
  const result = await anchorDecisions(db, b.id, wallet, { client });
  return result?.count ?? null;
}
