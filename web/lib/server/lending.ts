import "server-only";

import { eq } from "drizzle-orm";
import { formatUnits, getAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";

import {
  previewLendingDeposit,
  simulateLendingExit,
  symbolonContracts,
  toTransaction,
  vaultCall,
  withSlippage,
  type Deployment,
} from "@symbolon/chain";
import { lendingYield } from "@symbolon/core";
import { businesses, decisions, type Database } from "@symbolon/db";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

import { requireMember } from "./access";
import { readCurrentImplementation } from "./release";
import { AuthError } from "./errors";
import { percentToBps } from "./reserve-policy";
import { prepareChange, type PreparedChangeResult } from "./queued-change";
import type { SessionUser } from "./session";

const ZERO = "0x0000000000000000000000000000000000000000";
/** The contract's ceiling (`LendingLogic.MAX_LENDING_BPS`, plan 05zk Q3) */
const MAX_LENDING_BPS = 5_000;
const DEFAULT_SLIPPAGE_BPS = 50;
const DECIMALS = 6;
/** The first Vault release that has the lending functions (plan 05zk) */
const LENDING_FROM_RELEASE = 4;

/**
 * The release number of the implementation this Vault runs, from the registry's own record of it; null when it can't be read or
 * isn't a published release. The release-4 lens reads any Vault's storage without error, so "the lens answered" says nothing
 * about whether the Vault has the lending functions (plan 05zl 1.1, QA new 2).
 */
async function vaultRelease(client: PublicClient, deployment: Deployment, vault: Address): Promise<number | null> {
  const impl = await readCurrentImplementation(client, vault);
  if (!impl) return null;
  try {
    const r = await symbolonContracts(client, deployment).registry.read.release([impl]);
    return r.publishedAt > 0n ? Number(r.version) : null;
  } catch {
    return null;
  }
}

/** Refuses any lending action for a Vault that doesn't run release 4 or later, in words that say what to do */
async function requireLendingRelease(client: PublicClient, deployment: Deployment, vault: Address): Promise<void> {
  const version = await vaultRelease(client, deployment, vault);
  if (version === null) throw new AuthError(503, "Can't confirm which release this Vault runs right now. Try again shortly.");
  if (version < LENDING_FROM_RELEASE) {
    throw new AuthError(400, `This Vault runs release ${version}. The lending reserve needs release ${LENDING_FROM_RELEASE}; upgrade it in Settings first.`);
  }
}

export interface LendingVenueView {
  address: string;
  name: string;
  /** "test" venues are labelled as tests wherever they appear */
  kind: "test" | "production";
}

export interface LendingView {
  /** False when this Vault's release (or the lens in the registry) has no lending reserve */
  supported: boolean;
  /** The release number this Vault runs when it is older than the one with lending; null otherwise */
  currentRelease?: number | null;
  /** False when the chain couldn't be read this time: the screen says so and shows no numbers */
  readOk: boolean;
  policy: { enabled: boolean; maxLendingBps: number; venue: string | null };
  /** The current venue's listing, if it is one of ours */
  venue: LendingVenueView | null;
  /** The venues the owner may choose from: the registry's, never typed */
  venues: LendingVenueView[];
  cash: string;
  shares: string;
  /** Null when the venue couldn't be read */
  lendingValue: string | null;
  exit: { ok: true; assets: string } | { ok: false; reason: string } | null;
  /** Realised from stored share-price samples; null until there is a week of them */
  yield: { bps: number; days: number } | null;
  minOperating: string;
  paused: boolean;
}

function listed(deployment: Deployment): LendingVenueView[] {
  return deployment.lendingVenues
    .filter((v) => [deployment.tokens.usdc.toLowerCase()].includes(v.asset.toLowerCase()))
    .map((v) => ({ address: v.address, name: v.name, kind: v.kind }));
}

async function vaultOf(db: Database, businessId: string): Promise<Address> {
  const [b] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b?.vault) throw new AuthError(404, "No Vault created yet.");
  return getAddress(b.vault);
}

/** The lending reserve as Arc shows it now. A read that fails is reported as failed, never as zero. */
export async function loadLending(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<LendingView> {
  await requireMember(db, user.id, businessId, "owner", "approver", "requester");
  const vault = await vaultOf(db, businessId);
  const venues = listed(deployment);
  const empty: LendingView = {
    supported: false,
    readOk: true,
    policy: { enabled: false, maxLendingBps: 0, venue: null },
    venue: null,
    venues,
    cash: "0",
    shares: "0",
    lendingValue: null,
    exit: null,
    yield: null,
    minOperating: "0",
    paused: false,
  };
  const contracts = symbolonContracts(client, deployment);

  const release = await vaultRelease(client, deployment, vault);
  // a release that can't be confirmed is a failed read, never "available" and never a silent "not available"
  if (release === null) return { ...empty, supported: true, readOk: false };
  if (release < LENDING_FROM_RELEASE) return { ...empty, currentRelease: release };

  let status;
  try {
    status = await contracts.lens.read.lendingStatus([vault]);
  } catch {
    // an older lens or Vault release has no such function: not available, which is different from "can't read"
    return empty;
  }
  try {
    const [reserve, state] = await Promise.all([contracts.lens.read.getReservePolicy([vault]), contracts.lens.read.getVaultState([vault])]);
    const venue = status.policy.venue === ZERO ? null : getAddress(status.policy.venue);
    const exit = venue && status.shares > 0n ? await simulateLendingExit(client, venue, vault, status.shares) : null;
    const yieldNow = venue ? await lendingYield(db, deployment.chainId, venue).catch(() => null) : null;
    return {
      ...empty,
      supported: true,
      policy: { enabled: status.policy.enabled, maxLendingBps: Number(status.policy.maxLendingBps), venue },
      venue: venue ? (venues.find((v) => v.address === venue) ?? null) : null,
      cash: status.cash.toString(),
      shares: status.shares.toString(),
      lendingValue: venue && !status.valueKnown ? null : status.lendingValue.toString(),
      exit: exit ? (exit.ok ? { ok: true, assets: exit.assets.toString() } : { ok: false, reason: exit.reason }) : null,
      yield: yieldNow,
      minOperating: reserve.minOperating.toString(),
      paused: state.paused,
    };
  } catch {
    return { ...empty, supported: true, readOk: false };
  }
}

export interface LendingPolicyInput {
  enabled: boolean;
  /** Percent of the Vault's cash, 0 to 50, at most two decimals */
  maxPercent: string;
  /** One of the listed venues */
  venue: string;
}

/** Prepares the owner-signed `setLendingPolicy` (queued when it loosens, applied at once when it tightens). */
export async function prepareLendingPolicy(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  input: LendingPolicyInput,
): Promise<PreparedChangeResult> {
  await requireMember(db, user.id, businessId, "owner");
  const vault = await vaultOf(db, businessId);
  const maxLendingBps = percentToBps(input.maxPercent);
  if (maxLendingBps > MAX_LENDING_BPS) throw new AuthError(400, "The Vault allows at most 50% of its cash in a lending vault.");

  await requireLendingRelease(client, deployment, vault);
  const choice = listed(deployment).find((v) => v.address.toLowerCase() === String(input.venue).toLowerCase());
  const contracts = symbolonContracts(client, deployment);
  const current = await contracts.lens.read.getLendingPolicy([vault]).catch(() => {
    throw new AuthError(400, "This Vault's release doesn't have a lending reserve. Upgrade it first.");
  });
  const keepsCurrent = input.venue && current.venue !== ZERO && current.venue.toLowerCase() === String(input.venue).toLowerCase();
  if (input.enabled && !choice && !keepsCurrent) throw new AuthError(400, "Choose one of the listed lending vaults.");
  const venue = choice?.address ?? (keepsCurrent ? getAddress(current.venue) : ZERO);
  const enabled = input.enabled === true;
  if (enabled && venue === ZERO) throw new AuthError(400, "Choose a lending vault to switch lending on.");
  if (current.enabled === enabled && Number(current.maxLendingBps) === maxLendingBps && current.venue.toLowerCase() === venue.toLowerCase()) {
    throw new AuthError(400, "Nothing changed: these are the settings the Vault already has.");
  }
  return prepareChange(db, client, deployment, user, businessId, {
    kind: "setLendingPolicy",
    args: [{ enabled, maxLendingBps, venue }],
  });
}

function parseAmount(text: unknown): bigint {
  if (typeof text !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(text.trim())) {
    throw new AuthError(400, "Enter an amount like 1000 or 1000.50 (up to 6 decimals).");
  }
  const v = parseUnits(text.trim(), DECIMALS);
  if (v <= 0n) throw new AuthError(400, "The amount has to be more than zero.");
  return v;
}

async function recordOwnerMove(
  db: Database,
  businessId: string,
  kind: "sweep" | "redeem",
  inputs: Record<string, unknown>,
  rule: string,
  outcome: string,
): Promise<Hex> {
  const record: DecisionRecord = {
    version: 1,
    kind,
    business: businessId,
    subject: "treasury:lending",
    at: new Date().toISOString(),
    mode: "assist",
    inputs,
    options: [],
    rule,
    outcome,
  } as DecisionRecord;
  const { hash } = hashRecord(record);
  await db
    .insert(decisions)
    .values({ businessId, kind, subject: "treasury:lending", record: record as unknown as Record<string, unknown>, hash })
    .onConflictDoNothing();
  return hash;
}

/** Prepares an owner deposit into the lending vault; every Vault rule still applies and is mirrored here for the message. */
export async function prepareLendingDeposit(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  chainId: number,
  assetsText: unknown,
) {
  await requireMember(db, user.id, businessId, "owner");
  const vault = await vaultOf(db, businessId);
  await requireLendingRelease(client, deployment, vault);
  const contracts = symbolonContracts(client, deployment);
  const status = await contracts.lens.read.lendingStatus([vault]).catch(() => {
    throw new AuthError(400, "This Vault's release doesn't have a lending reserve.");
  });
  if (status.policy.venue === ZERO || !status.policy.enabled) throw new AuthError(400, "Lending is off for this Vault.");
  const state = await contracts.lens.read.getVaultState([vault]);
  if (state.paused) throw new AuthError(400, "The Vault is paused; deposits are blocked.");
  const assets = parseAmount(assetsText);
  if (assets > status.cash) throw new AuthError(400, "That is more than the Vault's cash.");
  const reserve = await contracts.lens.read.getReservePolicy([vault]);
  if (status.cash - assets < reserve.minOperating) {
    throw new AuthError(400, `That would leave less than the operating floor of ${formatUnits(reserve.minOperating, DECIMALS)} USDC.`);
  }
  if (status.valueKnown) {
    const after = status.lendingValue + assets;
    const total = status.cash + status.lendingValue;
    if (after * 10_000n > BigInt(status.policy.maxLendingBps) * total) {
      throw new AuthError(400, `That would take the lending vault above ${Number(status.policy.maxLendingBps) / 100}% of the Vault's cash.`);
    }
  }
  const quoted = await previewLendingDeposit(client, getAddress(status.policy.venue), assets).catch(() => {
    throw new AuthError(502, "Can't get the lending vault's quote from Arc right now. Try again shortly.");
  });
  const minShares = withSlippage(quoted, DEFAULT_SLIPPAGE_BPS);
  const decisionHash = await recordOwnerMove(
    db,
    businessId,
    "sweep",
    { assets: assets.toString(), minShares: minShares.toString(), quoted: quoted.toString(), venue: status.policy.venue, actor: user.id },
    "the owner manually deposited cash into the lending vault",
    "depositing",
  );
  const call = vaultCall(vault, "depositLending", [assets, minShares, decisionHash]);
  return { ...toTransaction(call), chainId, assets: assets.toString(), minShares: minShares.toString(), decisionHash };
}

/** Prepares an owner withdrawal from the lending vault: allowed while paused and with lending switched off. */
export async function prepareLendingRedeem(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  chainId: number,
  input: { assets?: unknown; all?: unknown },
) {
  await requireMember(db, user.id, businessId, "owner");
  const vault = await vaultOf(db, businessId);
  await requireLendingRelease(client, deployment, vault);
  const contracts = symbolonContracts(client, deployment);
  const status = await contracts.lens.read.lendingStatus([vault]).catch(() => {
    throw new AuthError(400, "This Vault's release doesn't have a lending reserve.");
  });
  if (status.policy.venue === ZERO || status.shares === 0n) throw new AuthError(400, "There is nothing in the lending vault.");
  if (!status.valueKnown) throw new AuthError(502, "Can't read the lending vault's value from Arc right now. Try again shortly.");

  let shares: bigint;
  if (input.all === true) {
    shares = status.shares;
  } else {
    const assets = parseAmount(input.assets);
    if (assets > status.lendingValue) throw new AuthError(400, "That is more than the lending vault holds for this Vault.");
    shares = (assets * status.shares + status.lendingValue - 1n) / status.lendingValue;
    if (shares > status.shares) shares = status.shares;
  }
  const venue = getAddress(status.policy.venue);
  const sim = await simulateLendingExit(client, venue, vault, shares);
  if (!sim.ok) throw new AuthError(409, `The lending vault can't pay out right now: ${sim.reason}. The shares stay in the Vault; try again later.`);
  const minAssets = withSlippage(sim.assets, DEFAULT_SLIPPAGE_BPS);
  const decisionHash = await recordOwnerMove(
    db,
    businessId,
    "redeem",
    { shares: shares.toString(), minAssets: minAssets.toString(), simulated: sim.assets.toString(), venue, actor: user.id },
    "the owner manually withdrew from the lending vault to cash",
    "redeeming",
  );
  const call = vaultCall(vault, "redeemLending", [shares, minAssets, decisionHash]);
  return { ...toTransaction(call), chainId, shares: shares.toString(), minAssets: minAssets.toString(), expected: sim.assets.toString(), decisionHash };
}
