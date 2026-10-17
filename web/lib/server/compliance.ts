import "server-only";

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { symbolonContracts, symbolonVaultAbi, vaultCall, type Deployment } from "@symbolon/chain";
import { CircleScreening, CircleScreeningError, type ScreeningProvider } from "@symbolon/core";
import { businesses, chainEvents, decisions, payees, screenings, seals, type Database } from "@symbolon/db";
import { Risk } from "@symbolon/steward";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import { awaitReceipt } from "./tx-receipt";
import { blockSeal } from "./inbox";
import type { AppConfig } from "./load-config";
import type { SessionUser } from "./session";

const HASH = /^0x[0-9a-fA-F]{64}$/;
const RISK_LABELS = ["Low", "Medium", "High", "Blocked"] as const;

export interface CounterpartyScreeningRow {
  seal: Address;
  name: string;
  payoutAddress: Address | null;
  payoutDomain: number | null;
  onchainRisk: number | null;
  riskLabel: string;
  screenedAt: string | null;
  status: "current" | "due" | "never" | "not_required" | "not_payee" | "unavailable";
  statusLabel: string;
  hasAddressMismatch: boolean;
  latestScreeningId: string | null;
  /** The Vault already holds a screening made at or after this one, so there is nothing left to save (plan 05zl 5) */
  latestWritten: boolean;
  /** The transaction that wrote the Vault's current screening, when it is on record (QA SYM-03); null when it can't be found */
  savedTx: Hex | null;
}

/**
 * The transaction that wrote a payee's screening into the Vault (QA SYM-03, retest 17: "Saved in the Vault" never linked one, because
 * only a save made in the open page knew its hash). First the app's own `screening_recorded` record for that screening, then the
 * Vault's `ScreeningSet` event from the mirrored chain history: the one with the Vault's current `screenedAt`, else the newest for
 * that Seal. Reads only the database; null when neither has it, and the page then says only "Saved in the Vault".
 */
export async function screeningSavedTx(
  db: Database,
  businessId: string,
  vault: string,
  seal: string,
  screeningId: string | null,
  screenedAtSec: bigint,
): Promise<Hex | null> {
  if (screeningId) {
    const [rec] = await db
      .select({ txHash: decisions.txHash })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.kind, "screening_recorded"), sql`${decisions.record}->'inputs'->>'screeningId' = ${screeningId}`, sql`${decisions.txHash} is not null`))
      .orderBy(desc(decisions.createdAt))
      .limit(1);
    if (rec?.txHash && HASH.test(rec.txHash)) return rec.txHash as Hex;
  }
  const events = await db
    .select({ txHash: chainEvents.txHash, args: chainEvents.args })
    .from(chainEvents)
    .where(and(sql`lower(${chainEvents.address}) = ${vault.toLowerCase()}`, eq(chainEvents.eventName, "ScreeningSet"), sql`lower(${chainEvents.args}->>'seal') = ${seal.toLowerCase()}`))
    .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
    .limit(20);
  const exact = events.find((e) => String((e.args as { screenedAt?: unknown }).screenedAt ?? "") === screenedAtSec.toString());
  const pick = exact ?? events[0];
  return pick && HASH.test(pick.txHash) ? (pick.txHash as Hex) : null;
}

export interface TierDescription {
  tier: string;
  action: string;
}

export interface ComplianceViewModel {
  businessId: string;
  businessName: string;
  vault: Address | null;
  counterparties: CounterpartyScreeningRow[];
  policyAvailable: boolean;
  tiers: TierDescription[];
  canScreen: boolean;
  canWrite: boolean;
}

/** Returns all screening rows for this business, newest first. */
export async function listScreenings(db: Database, businessId: string) {
  return db
    .select()
    .from(screenings)
    .where(eq(screenings.businessId, businessId))
    .orderBy(desc(screenings.screenedAt));
}

/**
 * Screens a payee's effective payout address via Circle Compliance Engine or an injected provider.
 * Allowed for owner and approver roles.
 */
export async function screenPayee(
  db: Database,
  cfg: Pick<AppConfig, "stewardCircle" | "testnet">,
  user: Pick<SessionUser, "id">,
  businessId: string,
  sealValue: unknown,
  options?: { provider?: ScreeningProvider; target?: "current" | "pending"; client?: PublicClient; deployment?: Deployment },
) {
  await requireMember(db, user.id, businessId, "owner", "approver");

  let seal: Address;
  try {
    seal = getAddress(sealValue as string);
  } catch {
    throw new AuthError(400, "That Seal address is malformed.");
  }

  const [business] = await db
    .select({ id: businesses.id, vault: businesses.vault, chainId: businesses.chainId })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business?.vault) {
    throw new AuthError(409, "This business doesn't have a Vault yet.");
  }

  const vault = getAddress(business.vault);

  // The address to screen is the payee's payout as the Vault reports it. No client or a failed read means we can't confirm it, so nothing is screened.
  if (!options?.client || !options?.deployment) {
    throw new AuthError(502, "Can't confirm this Vault's payees right now. Try again shortly.");
  }
  let payee: Awaited<ReturnType<ReturnType<typeof symbolonContracts>["lens"]["read"]["getPayee"]>>;
  try {
    payee = await symbolonContracts(options.client, options.deployment).lens.read.getPayee([vault, seal]);
  } catch (e) {
    console.error("compliance: reading the payee from the Vault failed", e);
    throw new AuthError(502, "Can't confirm this Vault's payees right now. Try again shortly.");
  }
  if (!payee.exists) {
    throw new AuthError(404, "Add this vendor as a payee first: a screening is saved against the payee's record in the Vault, which doesn't exist yet.");
  }

  // Screen the pending payout when asked for it, else the active one
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  const targetAddress: Address =
    options.target === "pending" && payee.pendingPayout && payee.pendingPayout !== ZERO_ADDR ? getAddress(payee.pendingPayout) : getAddress(payee.payout);

  const provider =
    options?.provider ??
    (cfg.stewardCircle?.apiKey
      ? new CircleScreening(cfg.stewardCircle.apiKey, cfg.testnet ? "ETH-SEPOLIA" : "ETH")
      : null);

  if (!provider) {
    throw new AuthError(502, "Screening isn't set up: this app has no Circle key to screen with. Nothing was recorded.");
  }

  let result;
  try {
    result = await provider.screen(targetAddress);
  } catch (err) {
    // Say what Circle said, in words: a failed screening is never recorded and never read as clean (plan 05zj C, D1)
    if (err instanceof CircleScreeningError) {
      if (err.status === 401) throw new AuthError(502, "Circle rejected this app's API key (401), so nothing could be screened. Nothing was recorded.");
      if (err.status === 403 || err.status === 404) {
        throw new AuthError(
          502,
          `Circle's Compliance Engine isn't enabled for this account (Circle answered ${err.status}). Until Circle turns it on, no address can be screened here, and none is treated as screened. Nothing was recorded.`,
        );
      }
      if (err.status === 429) throw new AuthError(502, "Circle is busy right now. Try again in a moment. Nothing was recorded.");
      throw new AuthError(502, `Circle couldn't screen this address right now (it answered ${err.status}). Nothing was recorded.`);
    }
    throw new AuthError(502, "Couldn't reach Circle to screen this address. Try again in a moment. Nothing was recorded.");
  }

  const [row] = await db
    .insert(screenings)
    .values({
      businessId,
      seal: seal.toLowerCase(),
      address: getAddress(result.address).toLowerCase(),
      risk: result.risk,
      result: result.result,
      ruleName: result.ruleName ?? null,
      actions: result.actions ?? [],
      categories: result.categories ?? [],
      provider: result.provider,
      screenedAt: result.screenedAt,
      createdBy: user.id,
    })
    .returning();

  // If Blocked, block vendor offchain loudly as well
  if (result.risk === Risk.Blocked) {
    await blockSeal(db, { chainId: business.chainId } as any, user, businessId, seal, true);
  }

  return row!;
}

/**
 * Prepares the owner-signed `setScreening(seal, risk, screenedAt)` transaction.
 */
export async function prepareScreeningWrite(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  screeningId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const [screening] = await db
    .select()
    .from(screenings)
    .where(and(eq(screenings.id, screeningId), eq(screenings.businessId, businessId)))
    .limit(1);

  if (!screening) {
    throw new AuthError(404, "Screening record not found.");
  }

  const [business] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business?.vault) {
    throw new AuthError(409, "This business doesn't have a Vault.");
  }

  const vault = getAddress(business.vault);
  const seal = getAddress(screening.seal);

  const block = await client.getBlock().catch(() => {
    throw new AuthError(502, "Can't confirm chain time right now. Try again shortly.");
  });

  const screenedAtSec = BigInt(Math.floor(screening.screenedAt.getTime() / 1000));
  if (screenedAtSec > block.timestamp) {
    throw new AuthError(400, "Screening timestamp cannot be in the future of the latest block.");
  }

  const c = symbolonContracts(client, deployment);
  const payee = await c.lens.read.getPayee([vault, seal]).catch(() => {
    throw new AuthError(502, "Can't confirm payee on Vault right now. Try again shortly.");
  });

  if (!payee.exists) {
    throw new AuthError(409, "Add this vendor as a payee first: a screening is saved against the payee's record in the Vault, which doesn't exist yet.");
  }

  const call = vaultCall(vault, "setScreening", [seal, screening.risk, screenedAtSec]);

  return {
    to: call.address,
    data: encodeFunctionData({
      abi: symbolonVaultAbi,
      functionName: call.functionName,
      args: call.args,
    }),
    chainId: deployment.chainId,
    summary: {
      seal,
      address: screening.address,
      risk: screening.risk,
      screenedAt: screening.screenedAt.toISOString(),
      screeningId,
    },
  };
}

/**
 * Confirms receipt of the owner-signed `setScreening` transaction and appends decision record.
 */
export async function recordScreeningWrite(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHashValue: unknown,
  screeningId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  if (typeof txHashValue !== "string" || !HASH.test(txHashValue)) {
    throw new AuthError(400, "That isn't a transaction hash.");
  }
  const txHash = txHashValue as Hex;

  // Check if already recorded (idempotent)
  const [existing] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.txHash, txHash)))
    .limit(1);

  if (existing) {
    const rec = existing.record as Record<string, unknown>;
    return {
      ok: true,
      txHash,
      risk: Number(rec.risk ?? 0),
      screenedAt: new Date(rec.screenedAt as string),
    };
  }

  const [screening] = await db
    .select()
    .from(screenings)
    .where(and(eq(screenings.id, screeningId), eq(screenings.businessId, businessId)))
    .limit(1);

  if (!screening) {
    throw new AuthError(404, "Screening record not found.");
  }

  const [business] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business?.vault) {
    throw new AuthError(409, "This business doesn't have a Vault.");
  }

  const vault = getAddress(business.vault);
  const seal = getAddress(screening.seal);

  const receipt = await awaitReceipt(client, txHash);

  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "That successful transaction was not sent to this business's Vault.");
  }

  const events = parseEventLogs({
    abi: symbolonVaultAbi,
    eventName: "ScreeningSet",
    logs: receipt.logs,
  }).filter((l) => getAddress(l.address) === vault);

  if (events.length !== 1) {
    throw new AuthError(409, "That transaction did not record exactly one screening on this Vault.");
  }

  const args = events[0]!.args;
  const screenedAtSec = BigInt(Math.floor(screening.screenedAt.getTime() / 1000));

  if (getAddress(args.seal) !== seal) {
    throw new AuthError(409, "Screening receipt seal mismatch.");
  }
  if (Number(args.risk) !== screening.risk) {
    throw new AuthError(409, "Screening receipt risk mismatch.");
  }
  if (args.screenedAt !== screenedAtSec) {
    throw new AuthError(409, "Screening receipt timestamp mismatch.");
  }

  const c = symbolonContracts(client, deployment);
  const payee = await c.lens.read.getPayee([vault, seal], { blockNumber: receipt.blockNumber }).catch(() => {
    throw new AuthError(502, "Can't re-read payee facts on Vault.");
  });

  if (payee.risk !== screening.risk || payee.screenedAt !== screenedAtSec) {
    throw new AuthError(409, "Vault lens payee facts do not reflect the screening.");
  }

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "screening_recorded",
      subject: seal,
      actor: user.id,
      inputs: {
        screeningId,
        seal,
        address: screening.address,
        risk: screening.risk,
        screenedAt: screening.screenedAt.toISOString(),
      },
      rule: "owner recorded screening result onchain",
      outcome: `Risk set to ${RISK_LABELS[screening.risk] ?? "Unknown"}`,
    },
    txHash,
  );

  return { ok: true, txHash, risk: screening.risk, screenedAt: screening.screenedAt };
}

function cleanCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  let s = String(val).replace(/[\r\n\t]/g, " ").trim();
  if (/^[=+\-@|%]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes('"') || s.includes(",")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Generates an RFC 4180 CSV compliance report for this business's screenings.
 */
export async function complianceReport(db: Database, businessId: string, from?: Date, to?: Date) {
  const conditions = [eq(screenings.businessId, businessId)];
  if (from) conditions.push(gte(screenings.screenedAt, from));
  if (to) conditions.push(lte(screenings.screenedAt, to));

  const rows = await db
    .select({
      screening: screenings,
      vendorName: seals.displayName,
      decisionHash: decisions.hash,
      decisionTx: decisions.txHash,
    })
    .from(screenings)
    .leftJoin(seals, eq(seals.address, screenings.seal))
    .leftJoin(
      decisions,
      and(
        eq(decisions.businessId, businessId),
        eq(decisions.kind, "screening_recorded"),
        sql`${decisions.record}->'inputs'->>'screeningId' = ${screenings.id}::text`,
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(screenings.screenedAt));

  const headers = [
    "Counterparty",
    "Seal",
    "Address",
    "Risk",
    "Result",
    "Rule",
    "Screened at",
    "Transaction",
    "Decision",
  ];

  // One row per counterparty (plan 05zj E, SYM-25): a vendor of this business that has never been screened is a row that says so,
  // not an absent line. "Never" means no screening on record at all, whatever the date filter.
  const everScreened = new Set(
    (await db.select({ seal: screenings.seal }).from(screenings).where(eq(screenings.businessId, businessId))).map((r) => r.seal.toLowerCase()),
  );
  const unscreened = (
    await db
      .select({ seal: payees.seal, vendorName: seals.displayName })
      .from(payees)
      .leftJoin(seals, eq(seals.address, payees.seal))
      .where(eq(payees.businessId, businessId))
  ).filter((p) => !everScreened.has(p.seal.toLowerCase()));

  const lines = [
    headers.join(","),
    ...unscreened.map((p) =>
      [cleanCsvField(p.vendorName ?? p.seal), cleanCsvField(p.seal), "", "Not screened", "Not screened", "", "", "", ""].join(","),
    ),
    ...rows.map((r) =>
      [
        cleanCsvField(r.vendorName ?? r.screening.seal),
        cleanCsvField(r.screening.seal),
        cleanCsvField(r.screening.address),
        cleanCsvField(RISK_LABELS[r.screening.risk] ?? r.screening.risk),
        cleanCsvField(r.screening.result),
        cleanCsvField(r.screening.ruleName ?? ""),
        cleanCsvField(r.screening.screenedAt.toISOString()),
        cleanCsvField(r.decisionTx ?? ""),
        cleanCsvField(r.decisionHash ?? ""),
      ].join(","),
    ),
  ];

  return lines.join("\r\n");
}

/**
 * Formulates the tier descriptions based on the Vault's policy parameters.
 */
export function describeTiers(policy: {
  screeningMaxAge: bigint | number;
  ownerThreshold?: bigint;
  autoPayLimit?: bigint;
  newVendorMinPaid?: bigint | number;
}): TierDescription[] {
  const maxAge = Number(policy.screeningMaxAge);
  const maxAgeDays = Math.floor(maxAge / 86400);

  return [
    { tier: "Low", action: "Pays normally within limits" },
    { tier: "Medium", action: "Needs a sign-off from an approver or the owner before payment" },
    { tier: "High", action: "Needs the owner's sign-off before payment" },
    { tier: "Blocked", action: "Blocked onchain; cannot be paid" },
    {
      tier: "Screening Age",
      action:
        maxAge > 0
          ? `Screening expires after ${maxAgeDays} days; stale screening blocks payment`
          : "Screening is not required by policy",
    },
  ];
}

/**
 * Loads the view model for `/business/compliance`.
 */
export async function loadComplianceView(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<ComplianceViewModel> {
  const membership = await requireMember(db, user.id, businessId);

  const [business] = await db
    .select({ id: businesses.id, name: businesses.name, vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    throw new AuthError(404, "That business doesn't exist.");
  }

  const isOwner = membership.role === "owner";
  const canScreen = isOwner || membership.role === "approver";
  const canWrite = isOwner;

  if (!business.vault) {
    return {
      businessId,
      businessName: business.name,
      vault: null,
      counterparties: [],
      policyAvailable: false,
      tiers: [],
      canScreen: false,
      canWrite: false,
    };
  }

  const vault = getAddress(business.vault);
  const c = symbolonContracts(client, deployment);

  const state = await c.lens.read.getVaultState([vault]).catch(() => null);
  const policy = state?.policy ?? null;

  const payeeRows = await db
    .select({
      payee: payees,
      vendor: seals,
    })
    .from(payees)
    .leftJoin(seals, eq(seals.address, payees.seal))
    .where(eq(payees.businessId, businessId))
    .orderBy(desc(payees.createdAt));

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const maxAge = policy ? BigInt(policy.screeningMaxAge) : null;

  const counterparties: CounterpartyScreeningRow[] = await Promise.all(
    payeeRows.map(async ({ payee, vendor }) => {
      const seal = getAddress(payee.seal);
      let onchainPayee = null;
      try {
        onchainPayee = await c.lens.read.getPayee([vault, seal]);
      } catch {
        // failed read stays null
      }

      const [latest] = await db
        .select()
        .from(screenings)
        .where(and(eq(screenings.businessId, businessId), eq(screenings.seal, seal.toLowerCase())))
        .orderBy(desc(screenings.screenedAt))
        .limit(1);

      // The lens answers for a seal the Vault doesn't know with zeroes. Those are "no record", not a payout, a risk or a screening.
      const known = onchainPayee?.exists === true;
      const screenedAtSec = known ? (onchainPayee?.screenedAt ?? 0n) : 0n;
      const payoutAddress = known && onchainPayee?.payout ? getAddress(onchainPayee.payout) : null;
      const payoutDomain = known ? (onchainPayee?.payoutDomain ?? null) : null;
      const onchainRisk = known && screenedAtSec > 0n ? (onchainPayee?.risk ?? null) : null;

      let status: CounterpartyScreeningRow["status"];
      let statusLabel: string;

      if (maxAge === null || !onchainPayee) {
        status = "unavailable";
        statusLabel = "Unavailable";
      } else if (!known) {
        status = "not_payee";
        statusLabel = "Not a payee yet";
      } else if (maxAge === 0n) {
        status = "not_required";
        statusLabel = "Not required";
      } else if (screenedAtSec === 0n) {
        status = "never";
        statusLabel = "Never";
      } else if (nowSec <= screenedAtSec + maxAge) {
        status = "current";
        statusLabel = "Current";
      } else {
        status = "due";
        statusLabel = "Due";
      }

      const hasAddressMismatch = Boolean(
        latest && payoutAddress && getAddress(latest.address) !== payoutAddress,
      );

      return {
        seal,
        name: vendor?.displayName ?? payee.seal,
        payoutAddress,
        payoutDomain,
        onchainRisk,
        riskLabel: !onchainPayee ? "Unavailable" : onchainRisk === null ? "Not screened" : RISK_LABELS[onchainRisk] ?? "Unknown",
        screenedAt: screenedAtSec > 0n ? new Date(Number(screenedAtSec) * 1000).toISOString() : null,
        status,
        statusLabel,
        hasAddressMismatch,
        latestScreeningId: latest?.id ?? null,
        latestWritten: Boolean(latest && screenedAtSec > 0n && BigInt(Math.floor(latest.screenedAt.getTime() / 1000)) <= screenedAtSec),
        savedTx: screenedAtSec > 0n ? await screeningSavedTx(db, businessId, vault, seal, latest?.id ?? null, screenedAtSec).catch(() => null) : null,
      };
    }),
  );

  return {
    businessId,
    businessName: business.name,
    vault,
    counterparties,
    policyAvailable: policy !== null,
    tiers: policy ? describeTiers(policy) : [],
    canScreen,
    canWrite,
  };
}
