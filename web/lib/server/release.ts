import "server-only";

import {
  getAddress,
  keccak256,
  toHex,
  encodeFunctionData,
  parseEventLogs,
  type Address,
  type PublicClient,
} from "viem";
import { eq } from "drizzle-orm";
import {
  symbolonVaultAbi,
  symbolonContracts,
  getReleaseNotes,
  type Deployment,
} from "@symbolon/chain";
import { businesses, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

/** EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1 */
export function getEip1967ImplementationSlot(): `0x${string}` {
  const hash = keccak256(toHex("eip1967.proxy.implementation"));
  const slotBigInt = BigInt(hash) - 1n;
  return (`0x` + slotBigInt.toString(16).padStart(64, "0")) as `0x${string}`;
}

export async function readCurrentImplementation(
  client: PublicClient,
  vault: Address,
): Promise<Address | null> {
  try {
    const slot = getEip1967ImplementationSlot();
    const val = await client.getStorageAt({ address: vault, slot });
    if (!val || val === "0x" || BigInt(val) === 0n) return null;
    return getAddress(("0x" + val.slice(-40)) as Address);
  } catch {
    return null;
  }
}

export type ReleaseLifecycleState =
  | "up-to-date"
  | "available"
  | "scheduled"
  | "ready"
  | "revoked"
  | "unknown";

export interface ReleaseViewInfo {
  state: ReleaseLifecycleState;
  current: {
    implementation: Address | null;
    version: number | null;
  };
  latest: {
    implementation: Address;
    version: number;
    publishedAt: number;
    revoked: boolean;
    notesHash: `0x${string}`;
    notes: string | null;
    notesVerified: boolean;
  };
  scheduled: {
    readyAt: number;
  };
  looseningDelay: number;
  currentBlockTimestamp: number;
}

export async function loadReleaseInfo(
  client: PublicClient,
  deployment: Deployment,
  vault: Address,
): Promise<ReleaseViewInfo> {
  const contracts = symbolonContracts(client, deployment);

  const [
    currentImpl,
    [latestImplRaw, latestVersionRaw],
    policy,
    block,
  ] = await Promise.all([
    readCurrentImplementation(client, vault),
    contracts.registry.read.latest(),
    contracts.lens.read.getPolicy([vault]),
    client.getBlock(),
  ]);

  const latestImpl = getAddress(latestImplRaw);
  const latestVersion = Number(latestVersionRaw);
  const currentBlockTimestamp = Number(block.timestamp);

  const [latestRelease, readyAtRaw, currentRelease] = await Promise.all([
    contracts.registry.read.release([latestImpl]),
    contracts.lens.read.scheduledUpgrade([vault, latestImpl]),
    currentImpl ? contracts.registry.read.release([currentImpl]).catch(() => null) : null,
  ]);

  const currentVersion = currentRelease && currentRelease.publishedAt > 0n
    ? Number(currentRelease.version)
    : null;

  const readyAt = Number(readyAtRaw);
  const notesInfo = getReleaseNotes(latestImpl);
  const notesVerified = Boolean(
    notesInfo &&
      notesInfo.notesHash.toLowerCase() === latestRelease.notesHash.toLowerCase(),
  );
  const verifiedNotes = notesVerified ? (notesInfo?.notes ?? null) : null;

  let state: ReleaseLifecycleState = "unknown";
  if (latestRelease.revoked) {
    state = "revoked";
  } else if (currentImpl && currentImpl.toLowerCase() === latestImpl.toLowerCase()) {
    state = "up-to-date";
  } else if (readyAt > 0) {
    state = currentBlockTimestamp >= readyAt ? "ready" : "scheduled";
  } else if (latestVersion > (currentVersion ?? 0) || (currentImpl && currentImpl.toLowerCase() !== latestImpl.toLowerCase())) {
    state = "available";
  } else {
    state = "up-to-date";
  }

  return {
    state,
    current: {
      implementation: currentImpl,
      version: currentVersion,
    },
    latest: {
      implementation: latestImpl,
      version: latestVersion,
      publishedAt: Number(latestRelease.publishedAt),
      revoked: latestRelease.revoked,
      notesHash: latestRelease.notesHash,
      notes: verifiedNotes,
      notesVerified,
    },
    scheduled: {
      readyAt,
    },
    looseningDelay: Number(policy.looseningDelay),
    currentBlockTimestamp,
  };
}

export interface ReleaseNudgeResult {
  hasNudge: boolean;
  latestVersion?: number;
  currentVersion?: number;
  implementation?: Address;
}

export async function checkReleaseNudge(
  client: PublicClient,
  deployment: Deployment,
  vault: Address,
): Promise<ReleaseNudgeResult> {
  try {
    const contracts = symbolonContracts(client, deployment);
    const [currentImpl, [latestImplRaw, latestVersionRaw]] = await Promise.all([
      readCurrentImplementation(client, vault),
      contracts.registry.read.latest(),
    ]);

    const latestImpl = getAddress(latestImplRaw);
    const latestVersion = Number(latestVersionRaw);

    const [latestRel, currentRel] = await Promise.all([
      contracts.registry.read.release([latestImpl]),
      currentImpl ? contracts.registry.read.release([currentImpl]).catch(() => null) : null,
    ]);

    if (latestRel.revoked) {
      return { hasNudge: false };
    }

    const currentVersion = currentRel ? Number(currentRel.version) : 0;
    if (
      currentImpl &&
      currentImpl.toLowerCase() !== latestImpl.toLowerCase() &&
      latestVersion > currentVersion
    ) {
      return {
        hasNudge: true,
        latestVersion,
        currentVersion,
        implementation: latestImpl,
      };
    }
    return { hasNudge: false };
  } catch {
    return { hasNudge: false };
  }
}

export interface VaultStateSnapshot {
  owner: Address;
  pendingOwner: Address;
  steward: Address;
  screener: Address;
  paused: boolean;
  accountingDecimals: number;
  autoUpdate: boolean;
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
}

export async function snapshotVaultState(
  client: PublicClient,
  deployment: Deployment,
  vault: Address,
): Promise<VaultStateSnapshot> {
  const contracts = symbolonContracts(client, deployment);
  const s = await contracts.lens.read.getVaultState([vault]);

  return {
    owner: getAddress(s.owner),
    pendingOwner: getAddress(s.pendingOwner),
    steward: getAddress(s.steward),
    screener: getAddress(s.screener),
    paused: Boolean(s.paused),
    accountingDecimals: Number(s.accountingDecimals),
    autoUpdate: Boolean(s.autoUpdate),
    policy: {
      perTxCap: s.policy.perTxCap.toString(),
      autoPayLimit: s.policy.autoPayLimit.toString(),
      ownerThreshold: s.policy.ownerThreshold.toString(),
      newVendorMinPaid: Number(s.policy.newVendorMinPaid),
      screeningMaxAge: s.policy.screeningMaxAge.toString(),
      newPayeeDelay: s.policy.newPayeeDelay.toString(),
      changeCooldown: s.policy.changeCooldown.toString(),
      looseningDelay: s.policy.looseningDelay.toString(),
      maxBridgeFee: s.policy.maxBridgeFee.toString(),
    },
  };
}

export function compareVaultSnapshots(
  before: VaultStateSnapshot,
  after: VaultStateSnapshot,
): { match: boolean; diffs: string[] } {
  const diffs: string[] = [];

  if (before.owner.toLowerCase() !== after.owner.toLowerCase()) {
    diffs.push(`owner (${before.owner} → ${after.owner})`);
  }
  if (before.steward.toLowerCase() !== after.steward.toLowerCase()) {
    diffs.push(`steward (${before.steward} → ${after.steward})`);
  }
  if (before.paused !== after.paused) {
    diffs.push(`paused (${before.paused} → ${after.paused})`);
  }
  if (before.accountingDecimals !== after.accountingDecimals) {
    diffs.push(`accountingDecimals (${before.accountingDecimals} → ${after.accountingDecimals})`);
  }
  if (before.autoUpdate !== after.autoUpdate) {
    diffs.push(`autoUpdate (${before.autoUpdate} → ${after.autoUpdate})`);
  }

  for (const [k, v] of Object.entries(before.policy)) {
    const nextVal = (after.policy as Record<string, unknown>)[k];
    if (v !== nextVal) {
      diffs.push(`policy.${k} (${v} → ${nextVal})`);
    }
  }

  return { match: diffs.length === 0, diffs };
}

export async function prepareScheduleUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
): Promise<{
  to: Address;
  data: `0x${string}`;
  chainId: number;
  latestImpl: Address;
  latestVersion: number;
  stateSnapshot: VaultStateSnapshot;
}> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, deployment);
  const [owner, [latestImplRaw, latestVersionRaw]] = await Promise.all([
    contracts.lens.read.getVaultState([vault]).then((s) => getAddress(s.owner)),
    contracts.registry.read.latest(),
  ]);

  if (!user.wallet || user.wallet.toLowerCase() !== owner.toLowerCase()) {
    throw new AuthError(403, "Only the onchain Vault owner wallet can schedule an upgrade.");
  }

  const latestImpl = getAddress(latestImplRaw);
  const latestVersion = Number(latestVersionRaw);
  const rel = await contracts.registry.read.release([latestImpl]);
  if (rel.revoked) {
    throw new AuthError(400, "The latest release is revoked and cannot be scheduled.");
  }

  const currentImpl = await readCurrentImplementation(client, vault);
  if (currentImpl && currentImpl.toLowerCase() === latestImpl.toLowerCase()) {
    throw new AuthError(400, "The Vault is already running the latest release.");
  }

  const stateSnapshot = await snapshotVaultState(client, deployment, vault);

  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: "scheduleUpgrade",
    args: [latestImpl],
  });

  return {
    to: vault,
    data,
    chainId: deployment.chainId,
    latestImpl,
    latestVersion,
    stateSnapshot,
  };
}

export async function recordScheduleUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHash: `0x${string}`,
): Promise<{ ok: true; readyAt: number; implementation: Address }> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Transaction reverted onchain.");
  }
  if (receipt.to && receipt.to.toLowerCase() !== vault.toLowerCase()) {
    throw new AuthError(400, "Transaction recipient does not match Vault.");
  }

  const logs = parseEventLogs({
    abi: symbolonVaultAbi,
    logs: receipt.logs,
    eventName: "UpgradeScheduled",
  });
  if (logs.length === 0) {
    throw new AuthError(400, "No UpgradeScheduled event found in transaction receipt.");
  }

  const event = logs[0]!;
  const implementation = getAddress(event.args.implementation);
  const readyAt = Number(event.args.readyAt);


  await appendAppDecision(db, businessId, {
    kind: "upgrade_scheduled",
    subject: `vault:${vault}:upgrade`,
    actor: user.id,
    inputs: {
      implementation,
      readyAt,
      txHash,
    },
    rule: "the owner scheduled a Vault implementation upgrade",
    outcome: "scheduled",
  });

  return { ok: true, readyAt, implementation };
}

export async function prepareCancelUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
): Promise<{
  to: Address;
  data: `0x${string}`;
  chainId: number;
  implementation: Address;
}> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, deployment);
  const [owner, [latestImplRaw]] = await Promise.all([
    contracts.lens.read.getVaultState([vault]).then((s) => getAddress(s.owner)),
    contracts.registry.read.latest(),
  ]);

  if (!user.wallet || user.wallet.toLowerCase() !== owner.toLowerCase()) {
    throw new AuthError(403, "Only the onchain Vault owner wallet can cancel an upgrade.");
  }

  const implementation = getAddress(latestImplRaw);
  const readyAt = await contracts.lens.read.scheduledUpgrade([vault, implementation]);
  if (readyAt === 0n) {
    throw new AuthError(400, "No upgrade is currently scheduled for this implementation.");
  }

  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: "cancelUpgrade",
    args: [implementation],
  });

  return {
    to: vault,
    data,
    chainId: deployment.chainId,
    implementation,
  };
}

export async function recordCancelUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHash: `0x${string}`,
): Promise<{ ok: true; implementation: Address }> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Transaction reverted onchain.");
  }
  if (receipt.to && receipt.to.toLowerCase() !== vault.toLowerCase()) {
    throw new AuthError(400, "Transaction recipient does not match Vault.");
  }

  const logs = parseEventLogs({
    abi: symbolonVaultAbi,
    logs: receipt.logs,
    eventName: "UpgradeCancelled",
  });
  if (logs.length === 0) {
    throw new AuthError(400, "No UpgradeCancelled event found in transaction receipt.");
  }

  const implementation = getAddress(logs[0]!.args.implementation);


  await appendAppDecision(db, businessId, {
    kind: "upgrade_cancelled",
    subject: `vault:${vault}:upgrade`,
    actor: user.id,
    inputs: { implementation, txHash },
    rule: "the owner cancelled a scheduled Vault implementation upgrade",
    outcome: "cancelled",
  });

  return { ok: true, implementation };
}

export async function prepareUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
): Promise<{
  to: Address;
  data: `0x${string}`;
  chainId: number;
  latestImpl: Address;
  latestVersion: number;
  stateSnapshotBefore: VaultStateSnapshot;
}> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, deployment);
  const [owner, [latestImplRaw, latestVersionRaw], block] = await Promise.all([
    contracts.lens.read.getVaultState([vault]).then((s) => getAddress(s.owner)),
    contracts.registry.read.latest(),
    client.getBlock(),
  ]);

  if (!user.wallet || user.wallet.toLowerCase() !== owner.toLowerCase()) {
    throw new AuthError(403, "Only the onchain Vault owner wallet can apply an upgrade.");
  }

  const latestImpl = getAddress(latestImplRaw);
  const latestVersion = Number(latestVersionRaw);
  const readyAt = await contracts.lens.read.scheduledUpgrade([vault, latestImpl]);
  if (readyAt === 0n) {
    throw new AuthError(400, "No upgrade is scheduled for this implementation.");
  }
  if (block.timestamp < readyAt) {
    throw new AuthError(400, `Upgrade delay has not elapsed yet (ready at ${readyAt}).`);
  }

  const stateSnapshotBefore = await snapshotVaultState(client, deployment, vault);

  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: "upgradeToAndCall",
    args: [latestImpl, "0x"],
  });

  return {
    to: vault,
    data,
    chainId: deployment.chainId,
    latestImpl,
    latestVersion,
    stateSnapshotBefore,
  };
}

export async function recordUpgrade(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHash: `0x${string}`,
  stateSnapshotBefore?: VaultStateSnapshot,
): Promise<{
  ok: true;
  stateMatch: boolean;
  diffs: string[];
  implementation: Address;
}> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "Business or Vault not found.");

  const vault = getAddress(b.vault);
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Transaction reverted onchain.");
  }
  if (receipt.to && receipt.to.toLowerCase() !== vault.toLowerCase()) {
    throw new AuthError(400, "Transaction recipient does not match Vault.");
  }

  const logs = parseEventLogs({
    abi: symbolonVaultAbi,
    logs: receipt.logs,
    eventName: "Upgraded",
  });
  if (logs.length === 0) {
    throw new AuthError(400, "No Upgraded event found in transaction receipt.");
  }

  const implementation = getAddress(logs[0]!.args.implementation);

  const stateSnapshotAfter = await snapshotVaultState(client, deployment, vault);

  let stateMatch = true;
  let diffs: string[] = [];
  if (stateSnapshotBefore) {
    const comparison = compareVaultSnapshots(stateSnapshotBefore, stateSnapshotAfter);
    stateMatch = comparison.match;
    diffs = comparison.diffs;
  }

  await appendAppDecision(db, businessId, {
    kind: "upgrade_applied",
    subject: `vault:${vault}:upgrade`,
    actor: user.id,
    inputs: {
      implementation,
      txHash,
      snapshotBefore: stateSnapshotBefore,
      snapshotAfter: stateSnapshotAfter,
      stateMatch,
      ...(diffs.length > 0 ? { diffs } : {}),
    },
    rule: "the owner applied a scheduled Vault implementation upgrade",
    outcome: stateMatch ? "applied" : "applied_state_diff",
  });

  return {
    ok: true,
    stateMatch,
    diffs,
    implementation,
  };
}
