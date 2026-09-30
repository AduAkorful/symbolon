import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { formatUnits, getAddress, type Address, type PublicClient } from "viem";

import { reserveYield, symbolonContracts } from "@symbolon/chain";
import { runSteward, syncVault, type StewardEnv } from "@symbolon/core";
import { businesses, decisions, stewardRuns, type Database } from "@symbolon/db";
import { CircleStewardWallet, createCircleClient, DEFAULT_EARLY_PAY, provisionStewardWallet, type EarlyPayProgram, type StewardWallet } from "@symbolon/steward";

import { ensureVaultBlock, type ChainSettings } from "./business";
import { AuthError } from "./errors";
import { getStewardModel } from "./steward-model";
import { ensureFresh } from "./sync";

/**
 * 0.01 native USDC (18 decimals on Arc) minimum fee balance.
 * A typical pay or anchor transaction on Arc costs ~0.0003 USDC (Fact 2 / S5).
 */
export const MIN_STEWARD_FEE_BALANCE = 10_000_000_000_000_000n;

/** Lease timeout: 5 minutes */
export const STEWARD_RUN_LEASE_MS = 5 * 60 * 1000;

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
    bufferDays: 30,
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
        return skipped!;
      }
    }

    // Chain sync
    await ensureFresh(db, client, cfg);
    const vaultBlock = await ensureVaultBlock(db, client, cfg.deployment, businessId, vault);
    await syncVault(db, client, cfg.deployment, vault, { fromBlock: vaultBlock });

    // Execute runSteward
    const env = await buildStewardEnv(db, client, cfg, b);
    const results = await runSteward(env, businessId);

    const outcomes: Record<string, number> = {};
    for (const r of results) {
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    }

    const summary = {
      invoicesConsidered: results.length,
      outcomes,
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
    throw error;
  }
}

export async function lastRun(db: Database, businessId: string): Promise<typeof stewardRuns.$inferSelect | null> {
  const [row] = await db.select().from(stewardRuns).where(eq(stewardRuns.businessId, businessId)).orderBy(desc(stewardRuns.startedAt)).limit(1);
  return row ?? null;
}

export async function listRunDecisions(db: Database, businessId: string, limit = 20): Promise<(typeof decisions.$inferSelect)[]> {
  return db.select().from(decisions).where(eq(decisions.businessId, businessId)).orderBy(desc(decisions.createdAt)).limit(limit);
}
