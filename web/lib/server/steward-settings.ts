import "server-only";

import { eq } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";

import { symbolonContracts } from "@symbolon/chain";
import { businesses, type Database } from "@symbolon/db";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { feeBalance, MIN_STEWARD_FEE_BALANCE, resolveStewardWallet, type StewardConfig } from "./steward-runtime";
import { readVaultState, stewardStanding } from "./vault-read";

export const STEWARD_MODES = ["shadow", "assist", "auto"] as const;
export type StewardMode = (typeof STEWARD_MODES)[number];

export function isStewardMode(v: unknown): v is StewardMode {
  return typeof v === "string" && (STEWARD_MODES as readonly string[]).includes(v);
}

export async function readSettings(db: Database, businessId: string) {
  const [b] = await db
    .select({
      mode: businesses.stewardMode,
      earlyPay: businesses.earlyPay,
      stewardWallet: businesses.stewardWallet,
      vault: businesses.vault,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!b) throw new AuthError(404, "Business not found.");
  return b;
}

export async function setMode(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  newMode: unknown,
  policyConfirmed?: boolean,
): Promise<{ ok: true; mode: StewardMode }> {
  await requireMember(db, user.id, businessId, "owner");
  if (!isStewardMode(newMode)) {
    throw new AuthError(400, "Mode must be shadow, assist, or auto.");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");
  if (b.stewardMode === newMode) return { ok: true, mode: newMode };

  if (newMode === "auto") {
    if (!policyConfirmed) {
      throw new AuthError(400, "You must confirm the Vault's live policy limits before enabling Autonomous mode.");
    }
    if (!cfg.stewardCircle) {
      throw new AuthError(503, "Circle wallet integration is not configured on this server.");
    }
    if (!b.vault || !b.stewardWallet) {
      throw new AuthError(409, "Create the Vault first.");
    }

    const state = await readVaultState(client, cfg.deployment, b.vault);
    if (!state.ok) {
      throw new AuthError(502, "Could not verify Vault state onchain. Try again in a moment.");
    }

    const standing = stewardStanding(b.stewardWallet, state);
    if (standing.kind !== "active" && standing.kind !== "paused") {
      throw new AuthError(409, `The Steward's onchain standing is ${standing.kind}. Auto mode requires active or paused standing.`);
    }

    try {
      const wallet = await resolveStewardWallet(client, cfg, b);
      if (!wallet) throw new Error("Could not resolve Steward wallet");
    } catch (err) {
      throw new AuthError(502, `Could not verify Steward wallet: ${err instanceof Error ? err.message : String(err)}`);
    }

    const balance = await feeBalance(client, b.stewardWallet);
    if (balance === null || balance < MIN_STEWARD_FEE_BALANCE) {
      throw new AuthError(409, "The Steward wallet must have at least 0.01 USDC for network fees before enabling Autonomous mode.");
    }
  }

  const from = b.stewardMode;
  await db.update(businesses).set({ stewardMode: newMode }).where(eq(businesses.id, businessId));

  await appendAppDecision(db, businessId, {
    kind: "steward_mode_changed",
    actor: user.id,
    inputs: { from, to: newMode },
    rule: "the owner chose how far the Steward may act",
    outcome: newMode,
  });

  return { ok: true, mode: newMode };
}
