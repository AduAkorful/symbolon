import "server-only";

import { and, eq } from "drizzle-orm";
import { businesses, members, queuedChanges, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

export interface EarlyPaySettings {
  enabled: boolean;
  minSpreadBps: number;
  cashCapBps: number;
}

/**
 * T9: Early Pay program settings. Owner-only, offchain, recorded in decisions.
 */
export async function setEarlyPay(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  settings: unknown,
): Promise<{ ok: true; earlyPay: EarlyPaySettings }> {
  await requireMember(db, user.id, businessId, "owner");

  if (!settings || typeof settings !== "object") {
    throw new AuthError(400, "Invalid Early Pay settings.");
  }

  const s = settings as Record<string, unknown>;
  const enabled = Boolean(s.enabled);
  const minSpreadBps = Number(s.minSpreadBps);
  const cashCapBps = Number(s.cashCapBps);

  if (!Number.isInteger(minSpreadBps) || minSpreadBps < 0 || minSpreadBps > 10_000) {
    throw new AuthError(400, "Minimum spread must be between 0 and 100% (0 to 10,000 bps).");
  }
  if (!Number.isInteger(cashCapBps) || cashCapBps < 0 || cashCapBps > 10_000) {
    throw new AuthError(400, "Maximum commitment must be between 0 and 100% (0 to 10,000 bps).");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  const cleanSettings: EarlyPaySettings = { enabled, minSpreadBps, cashCapBps };

  await db
    .update(businesses)
    .set({ earlyPay: cleanSettings })
    .where(eq(businesses.id, businessId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "early_pay_changed",
      subject: "settings:early_pay",
      actor: user.id,
      inputs: {
        ...(b.earlyPay ? { previous: b.earlyPay } : {}),
        next: cleanSettings,
      },
      rule: "the owner configured the Early Pay program",
      outcome: enabled ? "enabled" : "disabled",
    },
  );

  return { ok: true, earlyPay: cleanSettings };
}

/**
 * T9: Treasury cash buffer in days (1..90). Owner-only, offchain, recorded in decisions.
 */
export async function setBufferDays(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  days: unknown,
): Promise<{ ok: true; bufferDays: number }> {
  await requireMember(db, user.id, businessId, "owner");

  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > 90) {
    throw new AuthError(400, "Buffer must be between 1 and 90 days.");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  await db
    .update(businesses)
    .set({ bufferDays: d })
    .where(eq(businesses.id, businessId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "buffer_changed",
      subject: "settings:buffer",
      actor: user.id,
      inputs: {
        previous: b.bufferDays ?? 30,
        next: d,
      },
      rule: "the owner set the treasury operating buffer in days",
      outcome: "updated",
    },
  );

  return { ok: true, bufferDays: d };
}

import { getAddress, type Address, type PublicClient } from "viem";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { readCurrentImplementation } from "./release";

export interface SettingsViewData {
  business: {
    id: string;
    name: string;
    vault: string | null;
    createdAt: Date;
    earlyPay: EarlyPaySettings | null;
    bufferDays: number;
  };
  vaultDetails: {
    address: Address;
    owner: Address;
    pendingOwner: Address;
    steward: Address;
    screener: Address;
    paused: boolean;
    accountingDecimals: number;
    autoUpdate: boolean;
    currentImplementation: Address | null;
    supportedTokens: {
      address: Address;
      symbol: string;
      supported: boolean;
      /** A turn-on that is queued: when it can be applied (QA UI-10) */
      pendingOnAt?: string;
    }[];
  } | null;
}

/**
 * Rename business. Owner-only, offchain, recorded in decisions. 1-80 characters, text-safe.
 */
export async function renameBusiness(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  name: unknown,
  confirm = false,
): Promise<{ ok: true; name: string } | { ok: false; conflict: { id: string; name: string } }> {
  await requireMember(db, user.id, businessId, "owner");

  if (typeof name !== "string") {
    throw new AuthError(400, "Business name must be a string.");
  }

  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new AuthError(400, "Business name must be between 1 and 80 characters.");
  }

  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new AuthError(400, "Business name contains invalid control characters.");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  // another business this person owns already has this name: say so first, and go on only when they confirm (plan 05zj D, SYM-15)
  if (!confirm) {
    const owned = await db
      .select({ id: businesses.id, name: businesses.name })
      .from(members)
      .innerJoin(businesses, eq(businesses.id, members.businessId))
      .where(and(eq(members.userId, user.id), eq(members.role, "owner"), eq(businesses.chainId, b.chainId)));
    const same = owned.find((o) => o.id !== businessId && o.name.normalize("NFC").trim().toLowerCase() === trimmed.normalize("NFC").toLowerCase());
    if (same) return { ok: false, conflict: { id: same.id, name: same.name } };
  }

  await db.update(businesses).set({ name: trimmed }).where(eq(businesses.id, businessId));

  await appendAppDecision(db, businessId, {
    kind: "business_renamed",
    subject: `business:${businessId}`,
    actor: user.id,
    inputs: {
      previous: b.name,
      next: trimmed,
    },
    rule: "the owner renamed the business",
    outcome: "updated",
  });

  return { ok: true, name: trimmed };
}

/**
 * Load settings view data for the business and its Vault. Accessible to all members.
 */
export async function loadSettings(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<SettingsViewData> {
  await requireMember(db, user.id, businessId);

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  let vaultDetails: SettingsViewData["vaultDetails"] = null;
  if (b.vault) {
    const vault = getAddress(b.vault);
    const contracts = symbolonContracts(client, deployment);

    const [state, currentImpl] = await Promise.all([
      contracts.lens.read.getVaultState([vault]),
      readCurrentImplementation(client, vault),
    ]);

    const knownTokens: { address: Address; symbol: string }[] = [
      { address: deployment.tokens.usdc, symbol: "USDC" },
      { address: deployment.tokens.eurc, symbol: "EURC" },
    ];
    if (deployment.tokens.usyc) {
      knownTokens.push({ address: deployment.tokens.usyc, symbol: "USYC" });
    }

    const tokenSupport = await Promise.all(
      knownTokens.map(async (t) => {
        const supported = await contracts.lens.read
          .isSupportedToken([vault, t.address])
          .catch(() => false);
        return {
          address: t.address,
          symbol: t.symbol,
          supported,
        };
      }),
    );

    const waiting = await db
      .select({ summary: queuedChanges.summary, eta: queuedChanges.eta })
      .from(queuedChanges)
      .where(and(eq(queuedChanges.businessId, businessId), eq(queuedChanges.kind, "set_supported_token"), eq(queuedChanges.status, "queued")));
    const turnOnAt = new Map<string, string>();
    for (const row of waiting) {
      const d = (row.summary as { details?: { token?: string; supported?: boolean } } | null)?.details;
      if (d?.token && d.supported !== false) turnOnAt.set(d.token.toLowerCase(), new Date(row.eta).toISOString());
    }

    vaultDetails = {
      address: vault,
      owner: getAddress(state.owner),
      pendingOwner: getAddress(state.pendingOwner),
      steward: getAddress(state.steward),
      screener: getAddress(state.screener),
      paused: state.paused,
      accountingDecimals: Number(state.accountingDecimals),
      autoUpdate: state.autoUpdate,
      currentImplementation: currentImpl,
      supportedTokens: tokenSupport.map((t) => {
        const pendingOnAt = t.supported ? undefined : turnOnAt.get(t.address.toLowerCase());
        return pendingOnAt ? { ...t, pendingOnAt } : t;
      }),
    };
  }

  return {
    business: {
      id: b.id,
      name: b.name,
      vault: b.vault,
      createdAt: b.createdAt,
      earlyPay: b.earlyPay as EarlyPaySettings | null,
      bufferDays: b.bufferDays ?? 30,
    },
    vaultDetails,
  };
}

