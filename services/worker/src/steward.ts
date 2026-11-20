import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { formatUnits, getAddress, type PublicClient } from "viem";

import { reserveYield, symbolonContracts } from "@symbolon/chain";
import type { AppConfig } from "@symbolon/config";
import {
  anchorDecisions,
  ensureVaultBlock,
  expireOffers,
  notifyBusiness,
  notifyDueNotices,
  notifyPayeesActive,
  releaseDue,
  runLending,
  runSteward,
  runTreasury,
  syncVault,
  type StewardEnv,
} from "@symbolon/core";
import { businesses, decisionAnchors, decisions, stewardRuns, type Database } from "@symbolon/db";
import { CircleStewardWallet, createCircleClient, DEFAULT_EARLY_PAY, provisionStewardWallet, type EarlyPayProgram, type StewardWallet } from "@symbolon/steward";

import { stewardModel } from "./model.js";

/** 0.01 native USDC (18 decimals on Arc). A typical pay or anchor costs about 0.0003 USDC. */
const MIN_STEWARD_FEE_BALANCE = 10_000_000_000_000_000n;
/** A run still "running" after this was killed and will never report. */
const STEWARD_RUN_LEASE_MS = 150 * 1000;
/** How often a business is scheduled when nobody asked for a run. */
export const STEWARD_INTERVAL_MS = 5 * 60 * 1000;
const ANCHOR_BATCH_MIN = 5;
const RUN_VAULT_WINDOW_BLOCKS = 20_000n;
const RUN_VAULT_SYNC_DEADLINE_MS = 8_000;

let circleClient: ReturnType<typeof createCircleClient> | undefined;

async function feeBalance(client: PublicClient, stewardWallet: string): Promise<bigint | null> {
  try {
    return await client.getBalance({ address: getAddress(stewardWallet) });
  } catch (err) {
    console.error("feeBalance read failed:", err);
    return null;
  }
}

async function resolveStewardWallet(
  client: PublicClient,
  cfg: AppConfig,
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

async function buildStewardEnv(db: Database, client: PublicClient, cfg: AppConfig, business: typeof businesses.$inferSelect): Promise<StewardEnv> {
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

  const model = stewardModel(cfg);
  return {
    db,
    client,
    contracts,
    deployment: cfg.deployment,
    program,
    bufferDays: business.bufferDays ?? 30,
    reserveYieldBps,
    ...(model ? { model } : {}),
    walletFor: async (b) => resolveStewardWallet(client, cfg, b),
  };
}

function showUsd(raw: string): string {
  const whole = raw.split(".")[0] ?? "0";
  const dec = (raw.split(".")[1] ?? "").padEnd(2, "0").slice(0, 2);
  return `$${Number(whole).toLocaleString("en-US")}.${dec}`;
}

async function notifyRunFailure(db: Database, businessId: string, run: { id: string; error: string | null }) {
  await notifyBusiness(db, businessId, {
    kind: "steward_run_failed",
    subject: run.id,
    body: { reason: run.error ?? "A Steward cycle needs attention." },
    dedupeKey: `run:${run.id}`,
  }, { roles: ["owner"] });
}

async function anchorWhenDue(db: Database, client: PublicClient, cfg: AppConfig, b: typeof businesses.$inferSelect): Promise<number | null> {
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

/** Finishes a row that is already `running`. Decisions come from live vault reads, not from the indexer mirror. */
export async function executeRunning(db: Database, client: PublicClient, cfg: AppConfig, runId: string, businessId: string, trigger: "manual" | "schedule"): Promise<void> {
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b?.vault) {
    await db.update(stewardRuns).set({ status: "failed", finishedAt: new Date(), error: "This business has no Vault yet." }).where(eq(stewardRuns.id, runId));
    return;
  }

  await notifyPayeesActive(db, { businessId }).catch((e) => console.error("payee-active notices failed", e instanceof Error ? e.message : e));
  await notifyDueNotices(db, client, cfg.deployment, businessId);

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, cfg.deployment);

  try {
    await releaseDue(db, { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger }, new Date(), { businessId });
    await expireOffers(db, new Date());
    const state = await contracts.lens.read.getVaultState([vault]);
    if (state.paused) {
      await db.update(stewardRuns).set({ status: "skipped_paused", finishedAt: new Date(), summary: { reason: "payments_paused" } }).where(eq(stewardRuns.id, runId));
      return;
    }

    if (b.stewardMode === "auto") {
      if (!b.stewardWallet) {
        const [skipped] = await db
          .update(stewardRuns)
          .set({ status: "skipped_fees", finishedAt: new Date(), summary: { reason: "no_steward_wallet" }, error: "No Steward wallet provisioned" })
          .where(eq(stewardRuns.id, runId))
          .returning();
        if (skipped) await notifyRunFailure(db, businessId, skipped);
        return;
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
        if (skipped) await notifyRunFailure(db, businessId, skipped);
        return;
      }
    }

    // Activity history only. A pass decides from live reads. One window, and a failure never fails the run.
    try {
      const vaultBlock = await ensureVaultBlock(db, client, cfg.deployment, businessId, vault);
      await Promise.race([
        syncVault(db, client, cfg.deployment, vault, { fromBlock: vaultBlock, maxBlocks: RUN_VAULT_WINDOW_BLOCKS }),
        new Promise<void>((resolve) => setTimeout(resolve, RUN_VAULT_SYNC_DEADLINE_MS)),
      ]);
    } catch (syncErr) {
      console.warn("Vault history sync failed; the pass goes on from live reads:", syncErr);
    }

    const env = await buildStewardEnv(db, client, cfg, b);
    const results = await runSteward(env, businessId);

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
    try {
      const lendingResult = await runLending(env, businessId);
      if (lendingResult.action !== "none") {
        const inputs = (lendingResult.record?.inputs ?? {}) as { simulated?: unknown; plan?: { assets?: unknown } };
        const raw = String((lendingResult.action === "redeem" ? inputs.simulated : undefined) ?? inputs.plan?.assets ?? "");
        const amount = /^\d+$/.test(raw) ? ` ${showUsd(formatUnits(BigInt(raw), 6))}` : "";
        const lending = lendingResult.action === "redeem" ? `took${amount || " cash"} out of lending` : `moved${amount || " cash"} into lending`;
        treasuryAction = treasuryAction && treasuryAction !== "none" ? `${treasuryAction}; ${lending}` : lending;
      }
    } catch (lendingErr) {
      console.warn("Lending run failed; invoice pass succeeded:", lendingErr);
    }

    const outcomes: Record<string, number> = {};
    for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;

    let anchored: number | null = null;
    if (trigger === "schedule") {
      try {
        anchored = await anchorWhenDue(db, client, cfg, b);
      } catch (anchorErr) {
        console.warn("Scheduled anchoring failed; the pass itself succeeded:", anchorErr);
      }
    }

    await db.update(stewardRuns).set({
      status: "done",
      finishedAt: new Date(),
      summary: { invoicesConsidered: results.length, outcomes, treasuryAction, ...(anchored ? { anchored } : {}) },
    }).where(eq(stewardRuns.id, runId));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Run failed";
    await db.update(stewardRuns).set({ status: "failed", finishedAt: new Date(), error: errorMsg }).where(eq(stewardRuns.id, runId));
    await notifyRunFailure(db, businessId, { id: runId, error: errorMsg });
  }
}

async function claimQueued(db: Database): Promise<{ id: string; businessId: string; trigger: "manual" | "schedule" } | null> {
  const queued = await db.select().from(stewardRuns).where(eq(stewardRuns.status, "queued")).orderBy(asc(stewardRuns.startedAt)).limit(5);
  for (const row of queued) {
    const [running] = await db
      .select()
      .from(stewardRuns)
      .where(and(eq(stewardRuns.businessId, row.businessId), eq(stewardRuns.status, "running")))
      .limit(1);
    if (running && Date.now() - running.startedAt.getTime() > STEWARD_RUN_LEASE_MS) {
      await db.update(stewardRuns).set({ status: "failed", finishedAt: new Date(), error: "Previous lease expired" }).where(eq(stewardRuns.id, running.id));
    } else if (running) {
      continue;
    }
    try {
      const [claimed] = await db
        .update(stewardRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(stewardRuns.id, row.id), eq(stewardRuns.status, "queued")))
        .returning();
      if (!claimed) continue;
      const trigger = claimed.trigger === "schedule" ? "schedule" : "manual";
      return { id: claimed.id, businessId: claimed.businessId, trigger };
    } catch {
      /* another pass for this business is already running; leave the row queued */
    }
  }
  return null;
}

async function claimScheduled(db: Database): Promise<{ id: string; businessId: string; trigger: "schedule" } | null> {
  const rows = await db.select().from(businesses).where(isNotNull(businesses.vault));
  for (const biz of rows) {
    const [active] = await db
      .select({ id: stewardRuns.id, status: stewardRuns.status, startedAt: stewardRuns.startedAt })
      .from(stewardRuns)
      .where(and(eq(stewardRuns.businessId, biz.id), eq(stewardRuns.status, "running")))
      .limit(1);
    if (active && Date.now() - active.startedAt.getTime() <= STEWARD_RUN_LEASE_MS) continue;
    if (active) {
      await db.update(stewardRuns).set({ status: "failed", finishedAt: new Date(), error: "Previous lease expired" }).where(eq(stewardRuns.id, active.id));
    }
    const [queued] = await db
      .select({ id: stewardRuns.id })
      .from(stewardRuns)
      .where(and(eq(stewardRuns.businessId, biz.id), eq(stewardRuns.status, "queued")))
      .limit(1);
    if (queued) continue;
    const [last] = await db
      .select({ startedAt: stewardRuns.startedAt })
      .from(stewardRuns)
      .where(and(eq(stewardRuns.businessId, biz.id), eq(stewardRuns.trigger, "schedule")))
      .orderBy(desc(stewardRuns.startedAt))
      .limit(1);
    if (last && Date.now() - last.startedAt.getTime() < STEWARD_INTERVAL_MS) continue;
    try {
      const [inserted] = await db
        .insert(stewardRuns)
        .values({ businessId: biz.id, trigger: "schedule", mode: biz.stewardMode, status: "running" })
        .returning();
      if (!inserted) continue;
      return { id: inserted.id, businessId: biz.id, trigger: "schedule" };
    } catch {
      /* a run for this business started between the check and the insert */
    }
  }
  return null;
}

/** One Steward pass: a queued manual run if one is waiting, otherwise one business that is due. */
export async function runStewardTick(db: Database, client: PublicClient, cfg: AppConfig): Promise<void> {
  const next = (await claimQueued(db)) ?? (await claimScheduled(db));
  if (!next) return;
  await executeRunning(db, client, cfg, next.id, next.businessId, next.trigger);
}
