import { and, asc, desc, eq } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { canonicalJson } from "@symbolon/seal";

import {
  lendingSharePrice,
  previewLendingDeposit,
  simulateCall,
  simulateLendingExit,
  vaultCall,
  withSlippage,
  type ContractCall,
} from "@symbolon/chain";
import { businesses, decisions, invoices, lendingSamples, type Database } from "@symbolon/db";
import {
  hashRecord,
  measuredLendingYield,
  outflowsWithin,
  planLending,
  toRecordValue,
  type CashFlow,
  type DecisionRecord,
} from "@symbolon/steward";
import { inArray } from "drizzle-orm";

import { notifyBusiness } from "./domain-notifications.js";
import type { StewardEnv } from "./steward.js";
import { DEFAULT_TREASURY, type TreasuryOptions } from "./treasury.js";

export interface LendingResult {
  action: "none" | "deposit" | "redeem";
  reason: string;
  /** The part of the position the venue could not pay out at this pass (counted as unavailable, never as cash) */
  unavailable: bigint;
  record?: DecisionRecord;
  hash?: Hex;
  call?: ContractCall;
  txHash?: Hex;
}

/** Stores the venue's current share price. One row per block; a second call in the same block is a no-op. */
export async function sampleLendingPrice(env: StewardEnv, venue: Address): Promise<void> {
  const block = await env.client.getBlock();
  const { assets, shareDecimals } = await lendingSharePrice(env.client, venue);
  await env.db
    .insert(lendingSamples)
    .values({
      chainId: env.deployment.chainId,
      venue: venue.toLowerCase(),
      blockNumber: block.number,
      sampledAt: new Date(Number(block.timestamp) * 1000),
      shareDecimals,
      assets,
    })
    .onConflictDoNothing();
}

/** The venue's realised yield from stored samples, or null while there is under a week of them */
export async function lendingYield(db: Database, chainId: number, venue: Address): Promise<{ bps: number; days: number } | null> {
  const rows = await db
    .select()
    .from(lendingSamples)
    .where(and(eq(lendingSamples.chainId, chainId), eq(lendingSamples.venue, venue.toLowerCase())))
    .orderBy(asc(lendingSamples.sampledAt));
  return measuredLendingYield(rows.map((r) => ({ at: r.sampledAt, assets: r.assets })));
}

/**
 * One lending pass for a business (plan 05zk): keep the buffer in cash, put the excess in the owner's lending vault
 * within the owner's cap, redeem ahead of bills. The exit is simulated from the Vault's own address first and whatever
 * the venue can't pay now is reported as unavailable, never netted against what the forecast needs.
 */
export async function runLending(env: StewardEnv, businessId: string, opts: TreasuryOptions = DEFAULT_TREASURY): Promise<LendingResult> {
  const [biz] = await env.db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz?.vault) throw new Error(`business ${businessId} has no Vault yet`);
  const vault = getAddress(biz.vault);
  const lending = await env.contracts.lens.read.lendingStatus([vault]);
  const venue = lending.policy.venue;
  if (venue === "0x0000000000000000000000000000000000000000") {
    return { action: "none", reason: "no lending vault is set for this Vault", unavailable: 0n };
  }
  // sampling failing must not stop a pass: the yield simply has fewer points
  await sampleLendingPrice(env, venue).catch(() => undefined);

  const reserve = await env.contracts.lens.read.getReservePolicy([vault]);
  const exit = await simulateLendingExit(env.client, venue, vault, lending.shares);
  const now = (await env.client.getBlock()).timestamp;
  const open = await env.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), inArray(invoices.status, ["verified", "scheduled", "awaiting_approval"])));
  const flows: CashFlow[] = open.map((o) => ({
    at: BigInt(Math.floor(o.dueDate.getTime() / 1000)),
    amount: o.total - o.credited,
    direction: "out",
    ref: o.fingerprint,
  }));
  const plan = planLending({
    enabled: lending.policy.enabled,
    venueSet: true,
    maxLendingBps: lending.policy.maxLendingBps,
    minOperating: reserve.minOperating,
    cash: lending.cash,
    shares: lending.shares,
    lendingValue: lending.lendingValue,
    valueKnown: lending.valueKnown,
    exit,
    buffer: outflowsWithin(flows, now, env.bufferDays),
    upcoming: outflowsWithin(flows, now, opts.leadDays),
    minSweep: opts.minSweep,
    redeemMarginBps: opts.redeemMarginBps,
  });
  if (lending.shares > 0n && plan.unavailable > 0n) {
    // one notice a day: the owner needs to know money in the lending vault can't be taken out right now, not hear it every run
    const day = new Date(Number(now) * 1000).toISOString().slice(0, 10);
    await notifyBusiness(
      env.db,
      businessId,
      { kind: "lending_unavailable", subject: null, body: { unavailable: plan.unavailable.toString() }, dedupeKey: `lending_unavailable:${businessId}:${day}` },
      { roles: ["owner"] },
    ).catch(() => undefined);
  }
  if (plan.action === "none") return { action: "none", reason: plan.reason, unavailable: plan.unavailable };

  const mode = biz.stewardMode as DecisionRecord["mode"];
  const base = { version: 1 as const, business: businessId, at: new Date(Number(now) * 1000).toISOString(), mode };
  let record: DecisionRecord;
  let build: (hash: Hex) => ContractCall;
  let moved = 0n;

  if (plan.action === "deposit") {
    const quoted = await previewLendingDeposit(env.client, venue, plan.assets);
    const minShares = withSlippage(quoted, opts.slippageBps);
    record = toRecordValue({
      ...base,
      kind: "sweep",
      inputs: { lending, exit, plan, quoted, minShares, venue },
      options: [],
      rule: "keep the buffer in cash; the excess goes to the owner's lending vault within the owner's cap",
      outcome: mode === "auto" ? "depositing" : "proposed",
    }) as DecisionRecord;
    moved = plan.assets;
    build = (hash) => vaultCall(vault, "depositLending", [plan.assets, minShares, hash]);
  } else {
    const sim = await simulateLendingExit(env.client, venue, vault, plan.shares);
    if (!sim.ok) return { action: "none", reason: `the lending vault can't pay out right now (${sim.reason})`, unavailable: lending.lendingValue };
    const minAssets = withSlippage(sim.assets, opts.slippageBps);
    record = toRecordValue({
      ...base,
      kind: "redeem",
      inputs: { lending, exit, plan, simulated: sim.assets, minAssets, venue },
      options: [],
      rule: "redeem from the lending vault ahead of bills so the operating buffer holds",
      outcome: mode === "auto" ? "redeeming" : "proposed",
    }) as DecisionRecord;
    moved = sim.assets;
    build = (hash) => vaultCall(vault, "redeemLending", [plan.shares, minAssets, hash]);
  }

  const { hash } = hashRecord(record);
  const call = build(hash);
  const subject = "treasury:lending";
  const [last] = await env.db
    .select()
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.kind, record.kind), eq(decisions.subject, subject)))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  const lastPlan = (last?.record as { inputs?: { plan?: { action?: string; assets?: string | bigint; shares?: string | bigint } } })?.inputs?.plan;
  const lastOutcome = (last?.record as { outcome?: string })?.outcome;
  const duplicate =
    mode !== "auto" &&
    last &&
    lastOutcome === record.outcome &&
    lastPlan?.action === plan.action &&
    String(lastPlan?.assets ?? "") === String(plan.assets) &&
    String(lastPlan?.shares ?? "") === String("shares" in plan ? plan.shares : "");
  if (!duplicate) {
    await env.db.insert(decisions).values({ businessId, kind: record.kind, subject, record: record as unknown as Record<string, unknown>, hash }).onConflictDoNothing();
  }

  const wallet = (env.walletFor ? await env.walletFor({ id: businessId, vault, stewardWallet: biz.stewardWallet }) : undefined) ?? env.wallet;
  if (mode !== "auto" || !wallet) return { action: plan.action, reason: plan.reason, unavailable: plan.unavailable, record, hash, call };
  await simulateCall(env.client, call, wallet.address);
  const txHash = await wallet.send(call);
  // The sent transaction is its own row that supersedes the decision (as an invoice payment's is), and the owners hear about it:
  // a move the Steward makes with the Vault's money must never be visible only on the chain (QA LEND-3)
  const [prev] = await env.db.select({ id: decisions.id }).from(decisions).where(eq(decisions.hash, hash));
  const txRecord = { version: 1, kind: "tx", decision: hash, txHash };
  await env.db
    .insert(decisions)
    .values({
      businessId,
      kind: "tx",
      subject,
      record: txRecord,
      hash: keccak256(stringToBytes(canonicalJson(txRecord))),
      txHash: txHash.toLowerCase(),
      ...(prev ? { supersedes: prev.id } : {}),
    })
    .onConflictDoNothing();
  await notifyBusiness(
    env.db,
    businessId,
    {
      kind: "lending_moved",
      subject: null,
      body: { direction: plan.action === "deposit" ? "in" : "out", amount: moved.toString(), reason: plan.reason },
      dedupeKey: `lending_moved:${txHash.toLowerCase()}`,
    },
    { roles: ["owner"] },
  ).catch(() => undefined);
  return { action: plan.action, reason: plan.reason, unavailable: plan.unavailable, record, hash, call, txHash };
}
