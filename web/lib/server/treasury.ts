import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  previewRedeem,
  previewSubscribe,
  reserveYield,
  symbolonContracts,
  toTransaction,
  vaultCall,
  withSlippage,
  type Deployment,
} from "@symbolon/chain";
import {
  businesses,
  decisions,
  invoices,
  members,
  purchaseOrders,
  queuedChanges,
  recurringSeries,
  seals,
  seriesInvoices,
  type Database,
} from "@symbolon/db";
import {
  forecast,
  hashRecord,
  runwayDays,
  tokenShortfalls,
  type CashFlow,
  type DecisionRecord,
  type ForecastDay,
  type TokenShortfall,
} from "@symbolon/steward";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { parseUsdcAmount, type ChainSettings } from "./business";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const HASH_REGEX = /^0x[0-9a-fA-F]{64}$/;

export const FORECAST_HORIZON_DAYS = 35;
export const DEFAULT_BUFFER_DAYS = 30;
export const DEFAULT_SLIPPAGE_BPS = 50; // 0.5% price protection

export interface TreasuryBalance {
  amount: string;
  raw: string;
  decimals: number;
}

export interface TreasuryState {
  vault: string;
  block: string;
  balances: {
    usdc: TreasuryBalance | null;
    eurc: TreasuryBalance | null;
  };
  availability: { usdc: boolean; eurc: boolean; budget: boolean; reserve: boolean };
  operatingSplit: {
    cashUsdc: string;
    reserveUsdc: string;
    totalUsdc: string;
    reserveBps: number;
  } | null;
  budget: {
    cap: string;
    spent: string;
    periodLengthDays: number;
  } | null;
  reserve: {
    readAvailable: boolean;
    available: boolean;
    entitled: boolean;
    enabled: boolean;
    teller: string | null;
    usyc: string | null;
    shares: string;
    reserveValue: string;
    policy: {
      enabled: boolean;
      maxReserveBps: number;
      minOperating: string;
    };
    yieldBps: number | null;
    limitRemaining: string | null;
  };
  forecast: {
    horizonDays: number;
    bufferDays: number;
    days: {
      day: number;
      date: string;
      outflows: string;
      inflows: string;
      balance: string;
    }[];
    runwayDays: number | null;
    runwayStatement: string;
    events: {
      day: number;
      date: string;
      amount: string;
      delta: number;
      vendor: string;
      invoiceNumber: string;
      ref: string;
      token: string;
    }[];
  };
  shortfalls: {
    token: string;
    tokenSymbol: string;
    balance: string;
    due: string;
    short: string;
    earliestDueDate: string | null;
    invoices: {
      ref: string;
      vendor: string;
      invoiceNumber: string;
      amount: string;
      dueDate: string;
    }[];
  }[];
  earlyPay: {
    enabled: boolean;
    minSpreadBps: number;
    cashCapBps: number;
  } | null;
  queuedReservePolicy: {
    changeId: string;
    eta: string;
    status: string;
  } | null;
  pendingSweepProposal: {
    id: string;
    kind: string;
    action: "subscribe" | "redeem";
    assets?: string;
    shares?: string;
    reason: string;
    hash: string;
  } | null;
  comingObligations: {
    openPurchaseOrdersCount: number;
    openPurchaseOrdersTotal: string;
    unreleasedSeriesCount: number;
    unreleasedSeriesTotal: string;
  };
}

function ownerWallet(user: Pick<SessionUser, "wallet">): Address {
  if (!user.wallet) {
    throw new AuthError(409, "This account has no wallet. Sign in with a wallet to perform owner actions.");
  }
  return getAddress(user.wallet);
}

/**
 * T1, T2, T3, T5, T7: Load complete treasury state at one block.
 * Read-only for all members.
 */
export async function loadTreasury(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  businessId: string,
  user: Pick<SessionUser, "id">,
): Promise<TreasuryState> {
  await requireMember(db, user.id, businessId);

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "This business has no Vault created yet.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, deployment);
  const blockNumber = await client.getBlockNumber();

  // 1. Read balances at this block
  let usdcBal: bigint | null = null;
  let usdcDecimals = 6;
  try {
    const [bal, dec] = await Promise.all([
      client.readContract({
        address: deployment.tokens.usdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
        blockNumber,
      }),
      client.readContract({
        address: deployment.tokens.usdc,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber,
      }),
    ]);
    usdcBal = bal;
    usdcDecimals = dec;
  } catch (err) {
    console.warn("Failed reading USDC balance:", err);
  }

  let eurcBal: bigint | null = null;
  let eurcDecimals = 6;
  try {
    const [bal, dec] = await Promise.all([
      client.readContract({
        address: deployment.tokens.eurc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault],
        blockNumber,
      }),
      client.readContract({
        address: deployment.tokens.eurc,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber,
      }),
    ]);
    eurcBal = bal;
    eurcDecimals = dec;
  } catch (err) {
    console.warn("Failed reading EURC balance:", err);
  }

  // 2. Read operating budget from lens
  let budgetAvailable = false;
  let budgetInfo: TreasuryState["budget"] = null;
  try {
    const bgt = await contracts.lens.read.getBudget([vault, ZERO_BYTES32], { blockNumber });
    budgetAvailable = true;
    if (bgt.exists) {
      const nowBn = BigInt(Math.floor(Date.now() / 1000));
      const currentPeriodIndex = bgt.periodLength > 0n ? nowBn / bgt.periodLength : 0n;
      const spentThisPeriod = bgt.periodIndex === currentPeriodIndex ? bgt.spent : 0n;
      budgetInfo = {
        cap: formatUnits(bgt.cap, usdcDecimals),
        spent: formatUnits(spentThisPeriod, usdcDecimals),
        periodLengthDays: Number(bgt.periodLength / 86400n),
      };
    }
  } catch (err) {
    console.warn("Failed reading budget from lens:", err);
  }

  // 3. Read reserve status from lens
  let reserveStatus: Awaited<ReturnType<typeof contracts.lens.read.reserveStatus>> | null = null;
  let yieldBps: number | null = null;
  let limitRemaining: bigint | null = null;

  try {
    reserveStatus = await contracts.lens.read.reserveStatus([vault], { blockNumber });
    if (reserveStatus.usycTeller !== ZERO_ADDRESS) {
      try {
        const y = await reserveYield(client, reserveStatus.usycTeller, 30);
        yieldBps = y.bps;
      } catch (err) {
        console.warn("Could not read USYC reserve yield:", err);
      }

      if (reserveStatus.entitled && contracts.teller) {
        try {
          const today = await contracts.teller.read.todayTimestamp({ blockNumber });
          const rem = await contracts.teller.read.subscriptionLimitRemaining([vault, today], { blockNumber });
          limitRemaining = typeof rem === "bigint" ? rem : null;
        } catch {
          limitRemaining = null;
        }
      }
    }
  } catch (err) {
    console.warn("Failed reading reserveStatus from lens:", err);
  }

  const reserveAvailable = Boolean(reserveStatus && reserveStatus.usycTeller !== ZERO_ADDRESS);
  const reserveShares = reserveStatus?.shares ?? 0n;
  const reserveVal = reserveStatus?.reserveValue ?? 0n;
  const totalUsdc = (usdcBal ?? 0n) + reserveVal;
  const reserveBps = totalUsdc > 0n ? Number((reserveVal * 10_000n) / totalUsdc) : 0;

  // 4. Query unpaid invoices for cash flows
  const unpaid = await db
    .select({
      fingerprint: invoices.fingerprint,
      invoiceNumber: invoices.invoiceNumber,
      seal: invoices.seal,
      vendorName: seals.displayName,
      vendorHandle: seals.handle,
      token: invoices.token,
      total: invoices.total,
      credited: invoices.credited,
      dueDate: invoices.dueDate,
    })
    .from(invoices)
    .leftJoin(seals, eq(invoices.seal, seals.address))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ["verified", "scheduled", "awaiting_approval", "held"]),
      ),
    );

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const flowsWithToken = unpaid.map((inv) => {
    const remaining = inv.total > inv.credited ? inv.total - inv.credited : 0n;
    return {
      at: BigInt(Math.floor(inv.dueDate.getTime() / 1000)),
      amount: remaining,
      direction: "out" as const,
      ref: inv.fingerprint,
      token: inv.token.toLowerCase(),
      vendor: inv.vendorName || inv.vendorHandle || inv.seal,
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate,
    };
  });

  // Horizon: 35 days for chart
  const usdcAddress = deployment.tokens.usdc.toLowerCase();
  const eurcAddress = deployment.tokens.eurc.toLowerCase();

  const usdcFlows = flowsWithToken.filter((f) => f.token === usdcAddress);
  const rawDays = usdcBal === null ? [] : forecast(usdcBal, usdcFlows, nowSec, FORECAST_HORIZON_DAYS);
  const runway = usdcBal === null ? undefined : runwayDays(usdcBal, usdcFlows, nowSec, FORECAST_HORIZON_DAYS);

  let runwayStatement = `Cash covers everything due in the next ${FORECAST_HORIZON_DAYS} days.`;
  if (runway !== undefined) {
    const shortDate = new Date(Date.now() + runway * 86_400_000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    runwayStatement = `Cash runs short on ${shortDate} (USDC).`;
  }

  const chartDays = rawDays.map((d, idx) => {
    const dt = new Date(Number(d.day) * 86_400 * 1000);
    return {
      day: idx,
      date: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      outflows: formatUnits(d.outflows, usdcDecimals),
      inflows: formatUnits(d.inflows, usdcDecimals),
      balance: formatUnits(d.balance, usdcDecimals),
    };
  });

  const chartEvents = usdcFlows
    .filter((f) => f.at <= nowSec + BigInt(FORECAST_HORIZON_DAYS) * 86_400n)
    .map((f) => {
      const dayOffset = Number((f.at - nowSec) / 86_400n);
      const day = dayOffset < 0 ? 0 : dayOffset;
      return {
        day,
        date: f.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        amount: formatUnits(f.amount, usdcDecimals),
        delta: -Number(formatUnits(f.amount, usdcDecimals)),
        vendor: f.vendor,
        invoiceNumber: f.invoiceNumber,
        ref: f.ref,
        token: "USDC",
      };
    });

  // Shortfalls per token (buffer horizon: 30 days)
  const balancesMap = new Map<string, bigint>();
  if (usdcBal !== null) balancesMap.set(usdcAddress, usdcBal);
  if (eurcBal !== null) balancesMap.set(eurcAddress, eurcBal);

  const rawShortfalls = tokenShortfalls(balancesMap, flowsWithToken.filter((f) => balancesMap.has(f.token)), nowSec, b.bufferDays ?? DEFAULT_BUFFER_DAYS);
  const shortfallsList = rawShortfalls.map((s) => {
    const isEurc = s.token === eurcAddress;
    const symbol = isEurc ? "EURC" : "USDC";
    const dec = isEurc ? eurcDecimals : usdcDecimals;
    const invs = flowsWithToken
      .filter((f) => f.token === s.token && s.refs.includes(f.ref))
      .sort((a, b) => Number(a.at - b.at));

    return {
      token: s.token,
      tokenSymbol: symbol,
      balance: formatUnits(s.balance, dec),
      due: formatUnits(s.due, dec),
      short: formatUnits(s.short, dec),
      earliestDueDate: invs[0] ? invs[0].dueDate.toISOString() : null,
      invoices: invs.map((i) => ({
        ref: i.ref,
        vendor: i.vendor,
        invoiceNumber: i.invoiceNumber,
        amount: formatUnits(i.amount, dec),
        dueDate: i.dueDate.toISOString(),
      })),
    };
  });

  if (usdcBal === null || eurcBal === null || flowsWithToken.some(f => !balancesMap.has(f.token))) {
    runwayStatement = "Cash coverage unavailable: one or more token balances could not be read.";
  } else if (shortfallsList.length > 0) {
    runwayStatement = `${shortfallsList.map((s) => s.tokenSymbol).join(" and ")} cash runs short within the selected ${b.bufferDays ?? DEFAULT_BUFFER_DAYS}-day buffer.`;
  } else {
    runwayStatement = `USDC and EURC cash cover recorded bills in the selected ${b.bufferDays ?? DEFAULT_BUFFER_DAYS}-day buffer. The chart shows USDC only.`;
  }

  // 5. Queued reserve policy changes
  const [queued] = await db
    .select()
    .from(queuedChanges)
    .where(
      and(
        eq(queuedChanges.businessId, businessId),
        eq(queuedChanges.kind, "set_reserve_policy"),
        eq(queuedChanges.status, "queued"),
      ),
    )
    .orderBy(desc(queuedChanges.createdAt))
    .limit(1);

  // 6. Latest sweep proposal from Steward (T8)
  const [proposal] = await db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        inArray(decisions.kind, ["sweep", "redeem"]),
        eq(decisions.subject, "treasury:reserve"),
      ),
    )
    .orderBy(desc(decisions.createdAt))
    .limit(1);

  let pendingSweep: TreasuryState["pendingSweepProposal"] = null;
  if (proposal) {
    const rec = proposal.record as {
      outcome?: string;
      inputs?: { assets?: string | bigint; shares?: string | bigint; plan?: { action?: "subscribe" | "redeem"; reason?: string } };
      rule?: string;
    };
    if (rec?.outcome === "proposed") {
      const action = proposal.kind === "sweep" ? "subscribe" : "redeem";
      pendingSweep = {
        id: proposal.id,
        kind: proposal.kind,
        action,
        assets: rec.inputs?.assets?.toString(),
        shares: rec.inputs?.shares?.toString(),
        reason: rec.inputs?.plan?.reason ?? rec.rule ?? "Scheduled reserve adjustment",
        hash: proposal.hash,
      };
    }
  }

  // 7. Coming obligations: open POs and unreleased series
  const openPos = await db
    .select({ amount: purchaseOrders.amount })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.businessId, businessId), isNull(purchaseOrders.closedAt)));

  const totalOpenPo = openPos.reduce((sum, po) => sum + po.amount, 0n);

  const unreleased = await db
    .select({ total: invoices.total })
    .from(seriesInvoices)
    .innerJoin(recurringSeries, eq(seriesInvoices.seriesId, recurringSeries.id))
    .innerJoin(invoices, eq(seriesInvoices.fingerprint, invoices.fingerprint))
    .where(
      and(
        eq(recurringSeries.businessId, businessId),
        isNull(seriesInvoices.releasedAt),
      ),
    );

  const totalUnreleasedSeries = unreleased.reduce((sum, inv) => sum + inv.total, 0n);

  return {
    vault,
    block: blockNumber.toString(),
    balances: {
      usdc: usdcBal !== null ? { amount: formatUnits(usdcBal, usdcDecimals), raw: usdcBal.toString(), decimals: usdcDecimals } : null,
      eurc: eurcBal !== null ? { amount: formatUnits(eurcBal, eurcDecimals), raw: eurcBal.toString(), decimals: eurcDecimals } : null,
    },
    availability: { usdc: usdcBal !== null, eurc: eurcBal !== null, budget: budgetAvailable, reserve: reserveStatus !== null },
    operatingSplit: usdcBal === null || reserveStatus === null ? null : {
      cashUsdc: formatUnits(usdcBal ?? 0n, usdcDecimals),
      reserveUsdc: formatUnits(reserveVal, usdcDecimals),
      totalUsdc: formatUnits(totalUsdc, usdcDecimals),
      reserveBps,
    },
    budget: budgetInfo,
    reserve: {
      readAvailable: reserveStatus !== null,
      available: reserveAvailable,
      entitled: Boolean(reserveStatus?.entitled),
      enabled: Boolean(reserveStatus?.policy?.enabled),
      teller: reserveStatus?.usycTeller && reserveStatus.usycTeller !== ZERO_ADDRESS ? reserveStatus.usycTeller : null,
      usyc: reserveStatus?.usyc && reserveStatus.usyc !== ZERO_ADDRESS ? reserveStatus.usyc : null,
      shares: formatUnits(reserveShares, 6),
      reserveValue: formatUnits(reserveVal, usdcDecimals),
      policy: {
        enabled: Boolean(reserveStatus?.policy?.enabled),
        maxReserveBps: reserveStatus?.policy?.maxReserveBps ?? 0,
        minOperating: formatUnits(reserveStatus?.policy?.minOperating ?? 0n, usdcDecimals),
      },
      yieldBps,
      limitRemaining: typeof limitRemaining === "bigint" ? formatUnits(limitRemaining, usdcDecimals) : null,
    },
    forecast: {
      horizonDays: FORECAST_HORIZON_DAYS,
      bufferDays: b.bufferDays ?? DEFAULT_BUFFER_DAYS,
      days: chartDays,
      runwayDays: runway ?? null,
      runwayStatement,
      events: chartEvents,
    },
    shortfalls: shortfallsList,
    earlyPay: b.earlyPay ?? null,
    queuedReservePolicy: queued
      ? {
          changeId: queued.changeId,
          eta: queued.eta.toISOString(),
          status: queued.status,
        }
      : null,
    pendingSweepProposal: pendingSweep,
    comingObligations: {
      openPurchaseOrdersCount: openPos.length,
      openPurchaseOrdersTotal: formatUnits(totalOpenPo, usdcDecimals),
      unreleasedSeriesCount: unreleased.length,
      unreleasedSeriesTotal: formatUnits(totalUnreleasedSeries, usdcDecimals),
    },
  };
}

/**
 * T11: Prepare owner withdrawal from the Vault.
 * Destination is ALWAYS the owner's own wallet.
 */
export async function prepareWithdraw(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  client: PublicClient,
  tokenSymbol: "USDC" | "EURC",
  amountStr: unknown,
): Promise<{ to: Address; data: Hex; chainId: number; amount: string; token: Address; destination: Address }> {
  await requireMember(db, user.id, businessId, "owner");
  const owner = ownerWallet(user);

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");

  const vault = getAddress(b.vault);
  const tokenAddress = tokenSymbol === "EURC" ? cfg.deployment.tokens.eurc : cfg.deployment.tokens.usdc;
  const amount = parseUsdcAmount(amountStr);

  const balance = await client.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [vault],
  });

  if (amount > balance) {
    throw new AuthError(400, `Amount exceeds Vault's ${tokenSymbol} balance of ${formatUnits(balance, 6)}.`);
  }

  const call = vaultCall(vault, "withdraw", [tokenAddress, owner, amount]);
  return {
    ...toTransaction(call),
    chainId: cfg.chainId,
    amount: amount.toString(),
    token: tokenAddress,
    destination: owner,
  };
}

/**
 * T11: Record owner withdrawal after transaction confirms onchain.
 */
export async function recordWithdraw(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  client: PublicClient,
  txHash: unknown,
  reason?: string,
): Promise<{ ok: true; txHash: string }> {
  if (typeof txHash !== "string" || !HASH_REGEX.test(txHash)) {
    throw new AuthError(400, "Invalid transaction hash.");
  }
  await requireMember(db, user.id, businessId, "owner");
  const owner = ownerWallet(user);

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");

  const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") throw new AuthError(409, "Transaction failed onchain.");

  // Parse Withdrawn event from Vault
  const vault = getAddress(b.vault);
  const withdrawnEventAbi = parseAbiItem("event Withdrawn(address indexed token, address indexed to, uint256 amount)");

  const logs = receipt.logs
    .filter((l) => getAddress(l.address) === vault)
    .map((l) => {
      try {
        return decodeEventLog({ abi: [withdrawnEventAbi], data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.eventName === "Withdrawn");

  if (logs.length === 0) throw new AuthError(409, "No Withdrawn event found in transaction receipt.");
  const ev = logs[0]!.args;

  if (getAddress(ev.to) !== owner) {
    throw new AuthError(403, "Withdrawal recipient is not your wallet.");
  }

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "withdrawn",
      subject: "treasury:withdraw",
      actor: user.id,
      inputs: {
        token: ev.token,
        to: ev.to,
        amount: ev.amount.toString(),
        reason: reason ?? "Owner withdrawal",
      },
      rule: "the owner withdrew funds to their own wallet",
      outcome: "withdrawn",
      txHash: txHash.toLowerCase(),
    },
    txHash.toLowerCase(),
  );

  return { ok: true, txHash: txHash.toLowerCase() };
}

/**
 * T12: Prepare funding of USDC or EURC into the Vault from the owner's wallet.
 */
export async function prepareFund(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  amountStr: unknown,
  tokenSymbol: "USDC" | "EURC" = "USDC",
): Promise<{ to: Address; data: Hex; chainId: number; amount: string; token: Address }> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(409, "Create the Vault first.");

  const vault = getAddress(b.vault);
  const tokenAddress = tokenSymbol === "EURC" ? cfg.deployment.tokens.eurc : cfg.deployment.tokens.usdc;
  const value = parseUsdcAmount(amountStr);

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [vault, value],
  });

  return {
    to: tokenAddress,
    data,
    chainId: cfg.chainId,
    amount: value.toString(),
    token: tokenAddress,
  };
}

/**
 * T7: Prepare manual reserve subscription.
 * Owner-only; requires entitled, unpaused, enabled, and room under policy limits.
 */
export async function prepareSubscribe(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  client: PublicClient,
  assetsStr: unknown,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<{ to: Address; data: Hex; chainId: number; assets: string; minShares: string; decisionHash: Hex }> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, cfg.deployment);
  const status = await contracts.lens.read.reserveStatus([vault]);

  if (status.usycTeller === ZERO_ADDRESS) throw new AuthError(400, "USYC reserve is not supported on this chain.");
  if (!status.policy.enabled) throw new AuthError(400, "Reserve is currently disabled in policy.");
  if (!status.entitled) throw new AuthError(400, "Circle has not allowlisted this Vault for USYC.");

  const state = await contracts.lens.read.getVaultState([vault]);
  if (state.paused) throw new AuthError(400, "Vault is paused; subscriptions are blocked.");

  const assets = parseUsdcAmount(assetsStr);
  if (assets > status.cash) throw new AuthError(400, "Amount exceeds Vault's cash balance.");

  // Policy check: minOperating
  if (status.cash - assets < status.policy.minOperating) {
    throw new AuthError(400, `Subscription would bring cash below minOperating of ${formatUnits(status.policy.minOperating, 6)} USDC.`);
  }

  // Preview from Teller
  const preview = await previewSubscribe(contracts, vault, assets);
  if (assets > preview.limitRemaining) {
    throw new AuthError(400, `Amount exceeds Teller's daily subscription limit of ${formatUnits(preview.limitRemaining, 6)} USDC.`);
  }

  const minShares = withSlippage(preview.out, slippageBps);

  // Decision record with canonical hash
  const record: DecisionRecord = {
    version: 1,
    kind: "sweep",
    business: businessId,
    subject: "treasury:reserve",
    at: new Date().toISOString(),
    mode: "assist",
    inputs: {
      assets: assets.toString(),
      minShares: minShares.toString(),
      preview: { out: preview.out.toString(), price: preview.price.toString() },
      slippageBps,
      actor: user.id,
    },
    options: [],
    rule: "the owner manually subscribed cash into the USYC reserve",
    outcome: "subscribing",
  };

  const { hash: decisionHash } = hashRecord(record);

  await db
    .insert(decisions)
    .values({
      businessId,
      kind: "sweep",
      subject: "treasury:reserve",
      record: record as unknown as Record<string, unknown>,
      hash: decisionHash,
    })
    .onConflictDoNothing();

  const call = vaultCall(vault, "subscribeReserve", [assets, minShares, decisionHash]);
  return {
    ...toTransaction(call),
    chainId: cfg.chainId,
    assets: assets.toString(),
    minShares: minShares.toString(),
    decisionHash,
  };
}

/**
 * T7: Prepare manual reserve redemption.
 * Owner-only; allowed even while paused.
 */
export async function prepareRedeem(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  client: PublicClient,
  sharesStr: unknown,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<{ to: Address; data: Hex; chainId: number; shares: string; minAssets: string; decisionHash: Hex }> {
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");

  const vault = getAddress(b.vault);
  const contracts = symbolonContracts(client, cfg.deployment);
  const status = await contracts.lens.read.reserveStatus([vault]);

  if (status.usycTeller === ZERO_ADDRESS) throw new AuthError(400, "USYC reserve is not supported on this chain.");

  const shares = parseUnits(String(sharesStr).trim(), 6);
  if (shares <= 0n) throw new AuthError(400, "Shares must be greater than zero.");
  if (shares > status.shares) throw new AuthError(400, `Shares exceed Vault's USYC balance of ${formatUnits(status.shares, 6)}.`);

  const preview = await previewRedeem(contracts, vault, shares);
  const minAssets = withSlippage(preview.out, slippageBps);

  const record: DecisionRecord = {
    version: 1,
    kind: "redeem",
    business: businessId,
    subject: "treasury:reserve",
    at: new Date().toISOString(),
    mode: "assist",
    inputs: {
      shares: shares.toString(),
      minAssets: minAssets.toString(),
      preview: { out: preview.out.toString(), price: preview.price.toString() },
      slippageBps,
      actor: user.id,
    },
    options: [],
    rule: "the owner manually redeemed USYC reserve to cash",
    outcome: "redeeming",
  };

  const { hash: decisionHash } = hashRecord(record);

  await db
    .insert(decisions)
    .values({
      businessId,
      kind: "redeem",
      subject: "treasury:reserve",
      record: record as unknown as Record<string, unknown>,
      hash: decisionHash,
    })
    .onConflictDoNothing();

  const call = vaultCall(vault, "redeemReserve", [shares, minAssets, decisionHash]);
  return {
    ...toTransaction(call),
    chainId: cfg.chainId,
    shares: shares.toString(),
    minAssets: minAssets.toString(),
    decisionHash,
  };
}

/**
 * T7: Record reserve move after onchain confirmation.
 */
export async function recordReserveMove(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  client: PublicClient,
  txHash: unknown,
): Promise<{ ok: true; txHash: string; event: string }> {
  if (typeof txHash !== "string" || !HASH_REGEX.test(txHash)) {
    throw new AuthError(400, "Invalid transaction hash.");
  }
  await requireMember(db, user.id, businessId, "owner");

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");

  const vault = getAddress(b.vault);
  const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  if (receipt.status !== "success") throw new AuthError(409, "Transaction failed onchain.");

  const subEventAbi = parseAbiItem("event ReserveSubscribed(address indexed caller, uint256 assets, uint256 shares, bytes32 decisionHash)");
  const redEventAbi = parseAbiItem("event ReserveRedeemed(address indexed caller, uint256 shares, uint256 assets, bytes32 decisionHash)");

  let foundEvent = "";
  let dHash: string | null = null;

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== vault) continue;
    try {
      const parsed = decodeEventLog({ abi: [subEventAbi, redEventAbi], data: log.data, topics: log.topics });
      if (parsed.eventName === "ReserveSubscribed" || parsed.eventName === "ReserveRedeemed") {
        foundEvent = parsed.eventName;
        dHash = parsed.args.decisionHash;
        break;
      }
    } catch {
      // not our event
    }
  }

  if (!foundEvent || !dHash) {
    throw new AuthError(409, "No ReserveSubscribed or ReserveRedeemed event found in transaction receipt.");
  }

  // Decisions is append-only: a later row carries the transaction hash and supersedes the initial row
  const [existing] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.hash, dHash.toLowerCase())))
    .limit(1);

  if (existing) {
    const nextRecord = {
      ...(existing.record as Record<string, unknown>),
      at: new Date().toISOString(),
      outcome: "settled",
      txHash: txHash.toLowerCase(),
    };
    const { hash } = hashRecord(nextRecord as unknown as DecisionRecord);
    await db
      .insert(decisions)
      .values({
        businessId,
        kind: existing.kind,
        subject: existing.subject,
        record: nextRecord,
        hash,
        txHash: txHash.toLowerCase(),
        supersedes: existing.id,
      })
      .onConflictDoNothing();
  }

  return { ok: true, txHash: txHash.toLowerCase(), event: foundEvent };
}

/**
 * T6: Record EURC conversion after browser swap and transfer to Vault.
 */
export async function recordConversion(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  client: PublicClient,
  input: unknown,
): Promise<{ ok: true; swapTxHash: string; transferTxHash: string; amountTransferred: string }> {
  await requireMember(db, user.id, businessId, "owner");
  const owner = ownerWallet(user);

  if (!input || typeof input !== "object") throw new AuthError(400, "Invalid conversion input.");
  const p = input as Record<string, unknown>;

  const swapTxHash = String(p.swapTxHash ?? "");
  const transferTxHash = String(p.transferTxHash ?? "");


  if (!HASH_REGEX.test(swapTxHash) || !HASH_REGEX.test(transferTxHash)) {
    throw new AuthError(400, "Invalid transaction hashes.");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || !b.vault) throw new AuthError(404, "No Vault created yet.");
  const vault = getAddress(b.vault);

  // Verify swap tx on chain
  const swapReceipt = await client.getTransactionReceipt({ hash: swapTxHash as Hex });
  if (swapReceipt.status !== "success") throw new AuthError(409, "Swap transaction failed onchain.");
  if (getAddress(swapReceipt.from) !== owner) throw new AuthError(403, "Swap transaction was not sent from your wallet.");

  // Verify transfer tx on chain
  const transferReceipt = await client.getTransactionReceipt({ hash: transferTxHash as Hex });
  if (transferReceipt.status !== "success") throw new AuthError(409, "Transfer transaction failed onchain.");
  if (getAddress(transferReceipt.from) !== owner) throw new AuthError(403, "Transfer transaction was not sent from your wallet.");

  // Inspect Transfer(owner, vault, value) on EURC contract
  const eurc = cfg.deployment.tokens.eurc;
  const transferEventAbi = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

  const transferLogs = transferReceipt.logs
    .filter((l) => getAddress(l.address) === eurc)
    .map((l) => {
      try {
        return decodeEventLog({ abi: [transferEventAbi], data: l.data, topics: l.topics });
      } catch {
        return null;
      }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.eventName === "Transfer");

  const matchingLog = transferLogs.find((l) => getAddress(l.args.from) === owner && getAddress(l.args.to) === vault);
  if (!matchingLog) {
    throw new AuthError(409, "No EURC Transfer from your wallet to the Vault found in transfer transaction.");
  }

  // A successful transaction alone is not proof of conversion. Bind the EURC gain to this receipt.
  const gained = swapReceipt.logs.filter((l) => getAddress(l.address) === eurc).reduce((sum,l) => {
    try {
      const decoded = decodeEventLog({abi:[transferEventAbi],data:l.data,topics:l.topics});
      return sum + (getAddress(decoded.args.to) === owner ? decoded.args.value : 0n)
        - (getAddress(decoded.args.from) === owner ? decoded.args.value : 0n);
    } catch { return sum; }
  },0n);
  if (gained <= 0n || matchingLog.args.value <= 0n || matchingLog.args.value > gained || swapTxHash.toLowerCase() === transferTxHash.toLowerCase()) {
    throw new AuthError(409,"The transfer is not covered by confirmed EURC gained in this swap.");
  }
  const amountTransferred = matchingLog.args.value.toString();

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "eurc_conversion",
      subject: "treasury:conversion",
      actor: user.id,
      inputs: {
        swapTxHash: swapTxHash.toLowerCase(),
        transferTxHash: transferTxHash.toLowerCase(),
        amountTransferred,
        gainedEurc: gained.toString(),
      },
      rule: "the owner converted USDC to EURC and transferred it to the Vault",
      outcome: "converted",
      txHash: transferTxHash.toLowerCase(),
    },
    transferTxHash.toLowerCase(),
  );

  return {
    ok: true,
    swapTxHash: swapTxHash.toLowerCase(),
    transferTxHash: transferTxHash.toLowerCase(),
    amountTransferred,
  };
}
