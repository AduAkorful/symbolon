import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { formatUnits, getAddress, type PublicClient } from "viem";

import { reserveYield, symbolonContracts } from "@symbolon/chain";
import { type StewardEnv } from "@symbolon/core";
import { businesses, decisions, stewardRuns, type Database } from "@symbolon/db";
import { CircleStewardWallet, createCircleClient, DEFAULT_EARLY_PAY, provisionStewardWallet, type EarlyPayProgram, type StewardWallet } from "@symbolon/steward";

import { type ChainSettings } from "./business";
import { AuthError } from "./errors";
import { getStewardModel } from "./steward-model";
import { notPreparedPayment } from "./prepared-payment";

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
 * Asks the worker to run this business. The row stays queued until the worker claims it.
 * A running row past its lease is closed so a new request is not stuck behind a dead pass.
 */
export async function enqueueManualRun(
  db: Database,
  businessId: string,
  startedBy: string,
): Promise<typeof stewardRuns.$inferSelect> {
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "This business has no Vault yet.");

  const [active] = await db
    .select()
    .from(stewardRuns)
    .where(and(eq(stewardRuns.businessId, businessId), eq(stewardRuns.status, "running")))
    .limit(1);
  if (active && Date.now() - active.startedAt.getTime() > STEWARD_RUN_LEASE_MS) {
    await db.update(stewardRuns).set({ status: "failed", finishedAt: new Date(), error: "Previous lease expired" }).where(eq(stewardRuns.id, active.id));
  } else if (active) {
    throw new AuthError(409, "A Steward run is already in progress.");
  }

  const [queued] = await db
    .select()
    .from(stewardRuns)
    .where(and(eq(stewardRuns.businessId, businessId), eq(stewardRuns.status, "queued")))
    .limit(1);
  if (queued) return queued;

  const [inserted] = await db
    .insert(stewardRuns)
    .values({ businessId, trigger: "manual", mode: b.stewardMode, status: "queued", startedBy })
    .returning();
  return inserted!;
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
 * The most recent run the worker started on its interval, as stored. Whether the Steward runs on its own is a fact about what
 * calls it, so the screen says what the runs show and never claims a schedule (plan 05zj D14).
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

