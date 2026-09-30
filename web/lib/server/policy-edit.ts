import "server-only";

import { type Address, type Hex, type PublicClient } from "viem";
import { eq } from "drizzle-orm";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { businesses, type Database } from "@symbolon/db";
import type { VaultPolicy } from "@symbolon/steward";
import { AuthError } from "./errors";
import { requireMember } from "./access";
import { prepareChange, recordChange, listQueuedChanges } from "./queued-change";
import { describePolicyLines, describePolicyRuleItems, type PolicyRuleItem } from "./policy-text";
import { isLooseningPolicy } from "./loosening";

export interface PolicyViewData {
  vault: Address;
  accountingDecimals: number;
  policy: {
    perTxCap: string;
    autoPayLimit: string;
    ownerThreshold: string;
    newVendorMinPaid: number;
    screeningMaxAge: string;
    newPayeeDelay: string;
    changeCooldown: string;
    looseningDelay: string;
    maxBridgeFee: string;
  };
  rules: PolicyRuleItem[];
  lines: string[];
  looseningDelaySeconds: number;
  pendingChange?: {
    changeId: Hex;
    eta: Date;
    ready: boolean;
    summary: Record<string, unknown>;
  };
  warnings: string[];
}

export function validatePolicySanity(p: VaultPolicy): string[] {
  const warnings: string[] = [];
  if (p.autoPayLimit > p.ownerThreshold) {
    warnings.push("Auto-pay limit exceeds the owner threshold; payments between them will still require owner sign-off.");
  }
  if (p.ownerThreshold > p.perTxCap) {
    warnings.push("Owner threshold exceeds the per-transaction cap; payments above the cap will be blocked entirely.");
  }
  if (p.looseningDelay === 0n) {
    warnings.push("Loosening delay is set to 0. Every future loosening change will take effect immediately without a waiting period.");
  }
  if (p.changeCooldown < 86_400n) {
    warnings.push("Payout and Seal change cooldown is shorter than 24 hours.");
  }
  return warnings;
}

export async function loadPolicyView(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string },
  businessId: string,
): Promise<PolicyViewData> {
  await requireMember(db, user.id, businessId);

  const [biz] = await db
    .select({
      vault: businesses.vault,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!biz?.vault) {
    throw new AuthError(400, "Business has no vault configured");
  }
  const vault = biz.vault as Address;

  const contracts = symbolonContracts(client, deployment);
  const p = await contracts.lens.read.getPolicy([vault]);

  const currentPolicy: VaultPolicy = {
    perTxCap: p.perTxCap,
    autoPayLimit: p.autoPayLimit,
    ownerThreshold: p.ownerThreshold,
    newVendorMinPaid: Number(p.newVendorMinPaid),
    screeningMaxAge: p.screeningMaxAge,
    newPayeeDelay: p.newPayeeDelay,
    changeCooldown: p.changeCooldown,
    looseningDelay: p.looseningDelay,
    maxBridgeFee: p.maxBridgeFee,
  };

  const queued = await listQueuedChanges(db, businessId);
  const policyQueued = queued.find((q) => q.kind === "set_policy");

  const warnings = validatePolicySanity(currentPolicy);

  return {
    vault,
    accountingDecimals: 6,
    policy: {
      perTxCap: currentPolicy.perTxCap.toString(),
      autoPayLimit: currentPolicy.autoPayLimit.toString(),
      ownerThreshold: currentPolicy.ownerThreshold.toString(),
      newVendorMinPaid: currentPolicy.newVendorMinPaid,
      screeningMaxAge: currentPolicy.screeningMaxAge.toString(),
      newPayeeDelay: currentPolicy.newPayeeDelay.toString(),
      changeCooldown: currentPolicy.changeCooldown.toString(),
      looseningDelay: currentPolicy.looseningDelay.toString(),
      maxBridgeFee: currentPolicy.maxBridgeFee.toString(),
    },
    rules: describePolicyRuleItems(currentPolicy, 6),
    lines: describePolicyLines(currentPolicy, 6),
    looseningDelaySeconds: Number(currentPolicy.looseningDelay),
    pendingChange: policyQueued
      ? {
          changeId: policyQueued.changeId as Hex,
          eta: policyQueued.eta,
          ready: policyQueued.eta.getTime() <= Date.now() && policyQueued.status === "queued",
          summary: policyQueued.summary,
        }
      : undefined,
    warnings,
  };
}

export async function preparePolicyChange(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  nextPolicyInput: {
    perTxCap: bigint;
    autoPayLimit: bigint;
    ownerThreshold: bigint;
    newVendorMinPaid: number;
    screeningMaxAge: bigint;
    newPayeeDelay: bigint;
    changeCooldown: bigint;
    looseningDelay: bigint;
    maxBridgeFee: bigint;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const [biz] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!biz?.vault) {
    throw new AuthError(400, "Business has no vault configured");
  }
  const vault = biz.vault as Address;

  // Read current policy to verify it actually changes
  const contracts = symbolonContracts(client, deployment);
  const cur = await contracts.lens.read.getPolicy([vault]);

  const currentPolicy: VaultPolicy = {
    perTxCap: cur.perTxCap,
    autoPayLimit: cur.autoPayLimit,
    ownerThreshold: cur.ownerThreshold,
    newVendorMinPaid: Number(cur.newVendorMinPaid),
    screeningMaxAge: cur.screeningMaxAge,
    newPayeeDelay: cur.newPayeeDelay,
    changeCooldown: cur.changeCooldown,
    looseningDelay: cur.looseningDelay,
    maxBridgeFee: cur.maxBridgeFee,
  };

  const nextPolicy: VaultPolicy = {
    perTxCap: BigInt(nextPolicyInput.perTxCap),
    autoPayLimit: BigInt(nextPolicyInput.autoPayLimit),
    ownerThreshold: BigInt(nextPolicyInput.ownerThreshold),
    newVendorMinPaid: Number(nextPolicyInput.newVendorMinPaid),
    screeningMaxAge: BigInt(nextPolicyInput.screeningMaxAge),
    newPayeeDelay: BigInt(nextPolicyInput.newPayeeDelay),
    changeCooldown: BigInt(nextPolicyInput.changeCooldown),
    looseningDelay: BigInt(nextPolicyInput.looseningDelay),
    maxBridgeFee: BigInt(nextPolicyInput.maxBridgeFee),
  };

  // Check differences
  const isIdentical =
    currentPolicy.perTxCap === nextPolicy.perTxCap &&
    currentPolicy.autoPayLimit === nextPolicy.autoPayLimit &&
    currentPolicy.ownerThreshold === nextPolicy.ownerThreshold &&
    currentPolicy.newVendorMinPaid === nextPolicy.newVendorMinPaid &&
    currentPolicy.screeningMaxAge === nextPolicy.screeningMaxAge &&
    currentPolicy.newPayeeDelay === nextPolicy.newPayeeDelay &&
    currentPolicy.changeCooldown === nextPolicy.changeCooldown &&
    currentPolicy.looseningDelay === nextPolicy.looseningDelay &&
    currentPolicy.maxBridgeFee === nextPolicy.maxBridgeFee;

  if (isIdentical) {
    throw new AuthError(400, "Proposed policy is identical to the current policy");
  }

  const isLooser = isLooseningPolicy(currentPolicy, nextPolicy);

  const prepared = await prepareChange(db, client, deployment, user, businessId, {
    kind: "set_policy",
    args: [nextPolicy],
  });

  return {
    ...prepared,
    isLooser,
  };
}

export async function recordPolicyChange(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  txHash: Hex,
) {
  await requireMember(db, user.id, businessId, "owner");
  return recordChange(db, client, deployment, user, businessId, txHash);
}
