import { and, eq, inArray } from "drizzle-orm";
import { getAddress, type Hex } from "viem";

import { previewRedeem, previewSubscribe, simulateCall, vaultCall, withSlippage, type ContractCall } from "@symbolon/chain";
import { businesses, decisions, invoices, type Database } from "@symbolon/db";
import { hashRecord, outflowsWithin, planReserve, toRecordValue, type CashFlow, type DecisionRecord } from "@symbolon/steward";

import type { StewardEnv } from "./steward.js";

export interface TreasuryOptions {
  /** Redeem this many days ahead of a bill (spec Flow 9: two days) */
  leadDays: number;
  minSweep: bigint;
  redeemMarginBps: number;
  slippageBps: number;
}

export const DEFAULT_TREASURY: TreasuryOptions = { leadDays: 2, minSweep: 1_000_000_000n, redeemMarginBps: 100, slippageBps: 50 };

export interface TreasuryResult {
  action: "none" | "subscribe" | "redeem";
  reason: string;
  record?: DecisionRecord;
  hash?: Hex;
  call?: ContractCall;
  txHash?: Hex;
}

/**
 * One treasury pass for a business (spec §7.5, Flow 9): keep the operating buffer in USDC, sweep the excess into USYC
 * within the owner's reserve policy, redeem ahead of upcoming bills. Only acts for Vaults whose reserve is on and that
 * Circle has allowlisted; min-outs come from the Teller's own preview for this Vault; the Vault re-checks everything.
 */
export async function runTreasury(env: StewardEnv, businessId: string, opts: TreasuryOptions = DEFAULT_TREASURY): Promise<TreasuryResult> {
  const [biz] = await env.db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz?.vault) throw new Error(`business ${businessId} has no Vault yet`);
  const vault = getAddress(biz.vault);
  const status = await env.contracts.lens.read.reserveStatus([vault]);
  if (status.usycTeller === "0x0000000000000000000000000000000000000000") {
    return { action: "none", reason: "this Vault's release has no USYC reserve" };
  }

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
  const plan = planReserve({
    enabled: status.policy.enabled,
    entitled: status.entitled,
    maxReserveBps: status.policy.maxReserveBps,
    minOperating: status.policy.minOperating,
    cash: status.cash,
    shares: status.shares,
    reserveValue: status.reserveValue,
    buffer: outflowsWithin(flows, now, env.bufferDays),
    upcoming: outflowsWithin(flows, now, opts.leadDays),
    minSweep: opts.minSweep,
    redeemMarginBps: opts.redeemMarginBps,
  });
  if (plan.action === "none") return { action: "none", reason: plan.reason };

  const mode = biz.stewardMode as DecisionRecord["mode"];
  const base = { version: 1 as const, business: businessId, at: new Date(Number(now) * 1000).toISOString(), mode };
  let record: DecisionRecord;
  let build: (hash: Hex) => ContractCall;

  if (plan.action === "subscribe") {
    const preview = await previewSubscribe(env.contracts, vault, plan.assets);
    const assets = plan.assets > preview.limitRemaining ? preview.limitRemaining : plan.assets;
    if (assets < opts.minSweep) return { action: "none", reason: "Circle's daily subscription limit leaves less than the sweep threshold" };
    const minShares = withSlippage(assets === plan.assets ? preview.out : (await previewSubscribe(env.contracts, vault, assets)).out, opts.slippageBps);
    record = toRecordValue({
      ...base,
      kind: "sweep",
      inputs: { status, plan, preview, assets, minShares },
      options: [],
      rule: "keep the buffer in cash; the excess earns the reserve yield within the owner's reserve policy",
      outcome: mode === "auto" ? "subscribing" : "proposed",
    }) as DecisionRecord;
    build = (hash) => vaultCall(vault, "subscribeReserve", [assets, minShares, hash]);
  } else {
    const preview = await previewRedeem(env.contracts, vault, plan.shares);
    const minAssets = withSlippage(preview.out, opts.slippageBps);
    record = toRecordValue({
      ...base,
      kind: "redeem",
      inputs: { status, plan, preview, minAssets },
      options: [],
      rule: "redeem ahead of bills so the operating buffer holds",
      outcome: mode === "auto" ? "redeeming" : "proposed",
    }) as DecisionRecord;
    build = (hash) => vaultCall(vault, "redeemReserve", [plan.shares, minAssets, hash]);
  }

  const { hash } = hashRecord(record);
  const call = build(hash);
  await env.db.insert(decisions).values({ businessId, kind: record.kind, record: record as unknown as Record<string, unknown>, hash });
  const wallet = (env.walletFor ? await env.walletFor({ id: businessId, vault, stewardWallet: biz.stewardWallet }) : undefined) ?? env.wallet;
  if (mode !== "auto" || !wallet) return { action: plan.action, reason: plan.reason, record, hash, call };

  await simulateCall(env.client, call, wallet.address);
  const txHash = await wallet.send(call);
  return { action: plan.action, reason: plan.reason, record, hash, call, txHash };
}
