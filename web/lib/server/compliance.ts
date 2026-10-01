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
import { CircleScreening, type ScreeningProvider } from "@symbolon/core";
import { businesses, decisions, payees, screenings, seals, type Database } from "@symbolon/db";
import { Risk } from "@symbolon/steward";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
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
  status: "current" | "due" | "never" | "not_required" | "unavailable";
  statusLabel: string;
  hasAddressMismatch: boolean;
  latestScreeningId: string | null;
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

  // Read the payee's current onchain state when a real client is available.
  // In tests, a mock provider is injected without a client; the lens read is skipped.
  type LensPayee = Awaited<ReturnType<ReturnType<typeof symbolonContracts>["lens"]["read"]["getPayee"]>>;
  let payee: LensPayee | undefined;
  if (options?.client && options?.deployment) {
    const c = symbolonContracts(options.client, options.deployment);
    try {
      payee = await c.lens.read.getPayee([vault, seal]);
    } catch {
      throw new AuthError(502, "Can't confirm this Vault's payees right now. Try again shortly.");
    }
  } else if (!options?.provider) {
    // No client and no test provider: can't proceed at all.
    throw new AuthError(502, "Can't confirm this Vault's payees right now. Try again shortly.");
  }

  if (payee !== undefined && !payee.exists) {
    throw new AuthError(404, "That vendor is not an active payee on the Vault.");
  }

  // Resolve the address to screen: prefer the pending payout when requested, else the active payout.
  // When payee is undefined (test-only: provider injected without client), fall back to the seal address.
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  let targetAddress: Address;
  if (payee === undefined) {
    targetAddress = seal; // test-only fallback; provider will screen this address
  } else if (options?.target === "pending" && payee.pendingPayout && payee.pendingPayout !== ZERO_ADDR) {
    targetAddress = getAddress(payee.pendingPayout);
  } else {
    targetAddress = getAddress(payee.payout);
  }

  const provider =
    options?.provider ??
    (cfg.stewardCircle?.apiKey
      ? new CircleScreening(cfg.stewardCircle.apiKey, cfg.testnet ? "ETH-SEPOLIA" : "ETH")
      : null);

  if (!provider) {
    throw new AuthError(
      502,
      "Screening isn't available: Circle's Compliance Engine isn't enabled for this account.",
    );
  }

  let result;
  try {
    result = await provider.screen(targetAddress);
  } catch (err) {
    throw new AuthError(
      502,
      `Circle screening failed: ${err instanceof Error ? err.message : String(err)}`,
    );
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
    throw new AuthError(409, "This vendor is not an active payee on the Vault.");
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

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly.");
  }

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
  const payee = await c.lens.read.getPayee([vault, seal]).catch(() => {
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

  const lines = [
    headers.join(","),
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
    { tier: "Medium", action: "Needs an approver's sign-off before payment" },
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

      const payoutAddress = onchainPayee?.payout ? getAddress(onchainPayee.payout) : null;
      const payoutDomain = onchainPayee?.payoutDomain ?? null;
      const onchainRisk = onchainPayee?.risk ?? null;
      const screenedAtSec = onchainPayee?.screenedAt ?? 0n;

      let status: CounterpartyScreeningRow["status"];
      let statusLabel: string;

      if (maxAge === null || !onchainPayee) {
        status = "unavailable";
        statusLabel = "Unavailable";
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
        riskLabel: onchainRisk === null ? "Unavailable" : RISK_LABELS[onchainRisk] ?? "Unknown",
        screenedAt: screenedAtSec > 0n ? new Date(Number(screenedAtSec) * 1000).toISOString() : null,
        status,
        statusLabel,
        hasAddressMismatch,
        latestScreeningId: latest?.id ?? null,
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
