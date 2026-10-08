import "server-only";

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { erc20Abi, getAddress, type PublicClient } from "viem";

import {
  businesses,
  chainEvents,
  decisions,
  invoices,
  payees,
  seals,
  stewardRuns,
  unsignedBills,
  type Database,
} from "@symbolon/db";
import { decodeSealedInvoice, verifySealedInvoice } from "@symbolon/seal";
import { forecast, runwayDays, tokenShortfalls } from "@symbolon/steward";

import { plainRunError } from "../run-error";
import { requireMember, type Role } from "./access";
import type { ChainSettings } from "./business";
import { summarizeDecision } from "./decision-text";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { feeBalance, type StewardConfig } from "./steward-runtime";
import { readVaultState, stewardStanding } from "./vault-read";

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];

/** A stored invoice record that no longer decodes is said out loud; nothing is guessed in its place */
const UNREADABLE_VENDOR = "Invoice can't be read";
function unreadable(problems: string[], fingerprint: string): void {
  console.error("stored invoice envelope does not decode", fingerprint);
  problems.push(`Invoice ${fingerprint.slice(0, 10)}… can't be read from its stored record, so it can't be shown or paid.`);
}

export interface NeedsYouSummary {
  awaitingApproval: {
    count: number;
    top: Array<{
      fingerprint: string;
      invoiceNumber: string;
      vendorName: string;
      amountFormatted: string;
      token: string;
      ruleNeededHuman: string;
    }>;
  };
  stewardHeld: {
    count: number;
    items: Array<{
      fingerprint: string;
      invoiceNumber: string;
      vendorName: string;
      reason: string;
    }>;
  };
  humanHeld: {
    count: number;
    items: Array<{
      fingerprint: string;
      invoiceNumber: string;
      vendorName: string;
    }>;
  };
  unsignedBillsCount: number;
  pendingVerificationsCount: number;
  problems: string[];
}

export interface TodaySummary {
  paymentsCount: number;
  paymentsAmountFormatted: string;
  scheduledCount: number;
  decisionsCount: number;
  asOfTime: Date;
}

export interface AheadSummary {
  upcomingInvoices: Array<{
    fingerprint: string;
    invoiceNumber: string;
    vendorName: string;
    amountFormatted: string;
    dueDate: Date;
    token: string;
  }>;
  shortfalls: Array<{
    tokenSymbol: string;
    shortFormatted: string;
    dueFormatted: string;
    earliestDueDate: Date | null;
  }>;
  runwayStatement: string;
}

function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/**
 * Loads the "Needs you" queue of items requiring human action (Decision A14).
 */
export async function loadNeedsYou(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<NeedsYouSummary> {
  await requireMember(db, user.id, businessId, ...VIEW_ROLES);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new AuthError(404, "Business not found.");

  const problems: string[] = [];

  // 1. Awaiting approval invoices (count + top 5)
  const awaitingRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "awaiting_approval")))
    .orderBy(desc(invoices.receivedAt));

  const topAwaiting: NeedsYouSummary["awaitingApproval"]["top"] = [];
  for (const row of awaitingRows.slice(0, 5)) {
    let vendorName = UNREADABLE_VENDOR;
    let invoiceNumber = row.invoiceNumber ?? `${row.fingerprint.slice(0, 10)}…`;
    let token = "";
    let amountStr = "—";
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
      token = decoded.document.currency.symbol;
      amountStr = formatAmount(row.total, decoded.document.currency.decimals);
    } catch {
      unreadable(problems, row.fingerprint);
    }

    const [latestDec] = await db
      .select({ record: decisions.record })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);

    const rule = String((latestDec?.record as any)?.rule ?? "Approval required");

    topAwaiting.push({
      fingerprint: row.fingerprint,
      invoiceNumber,
      vendorName,
      amountFormatted: amountStr,
      token,
      ruleNeededHuman: rule,
    });
  }

  // 2. Steward-held invoices
  const stewardHeldRows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.status, "held"),
        or(eq(invoices.holdSource, "steward"), isNull(invoices.holdSource)),
      ),
    )
    .orderBy(desc(invoices.receivedAt));

  const stewardHeldItems: NeedsYouSummary["stewardHeld"]["items"] = [];
  for (const row of stewardHeldRows.slice(0, 5)) {
    let vendorName = UNREADABLE_VENDOR;
    let invoiceNumber = row.invoiceNumber ?? `${row.fingerprint.slice(0, 10)}…`;
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
    } catch {
      unreadable(problems, row.fingerprint);
    }

    const [latestDec] = await db
      .select({ record: decisions.record })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);

    const reason = String((latestDec?.record as any)?.rule ?? "No reason was recorded for this hold");

    stewardHeldItems.push({
      fingerprint: row.fingerprint,
      invoiceNumber,
      vendorName,
      reason,
    });
  }

  // 3. Human-held invoices
  const humanHeldRows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.status, "held"),
        eq(invoices.holdSource, "human"),
      ),
    )
    .orderBy(desc(invoices.receivedAt));

  const humanHeldItems: NeedsYouSummary["humanHeld"]["items"] = humanHeldRows.slice(0, 5).map((row) => {
    let vendorName = UNREADABLE_VENDOR;
    let invoiceNumber = row.invoiceNumber ?? `${row.fingerprint.slice(0, 10)}…`;
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
    } catch {
      unreadable(problems, row.fingerprint);
    }
    return {
      fingerprint: row.fingerprint,
      invoiceNumber,
      vendorName,
    };
  });

  // 4. Unsigned bills open
  const openBills = await db
    .select({ id: unsignedBills.id })
    .from(unsignedBills)
    .where(and(eq(unsignedBills.businessId, businessId), eq(unsignedBills.status, "open")));

  // 5. Verifications awaiting second
  const pendingVerifs = await db
    .select({ seal: payees.seal })
    .from(payees)
    .where(and(eq(payees.businessId, businessId), eq(payees.status, "pending_verification")));

  // 6. Problems (Steward fee balance, standing mismatch, failed last run)

  if (biz.vault) {
    const vault = getAddress(biz.vault);
    const standing = stewardStanding(biz.stewardWallet, await readVaultState(client, cfg.deployment, vault));
    if (standing.kind === "mismatch") {
      problems.push("The Steward this Vault reports onchain isn't the wallet configured for this business.");
    }

    if (biz.stewardMode === "auto" && biz.stewardWallet) {
      const bal = await feeBalance(client, biz.stewardWallet);
      if (bal !== null && bal === 0n) {
        problems.push("Steward fee balance is 0 USDC. Autonomous runs will skip until funded.");
      }
    }
  }

  const [lastRun] = await db
    .select()
    .from(stewardRuns)
    .where(eq(stewardRuns.businessId, businessId))
    .orderBy(desc(stewardRuns.startedAt))
    .limit(1);

  if (lastRun && lastRun.status === "failed") {
    problems.push(`Last Steward pass failed: ${plainRunError(lastRun.error)}`);
  }

  return {
    awaitingApproval: {
      count: awaitingRows.length,
      top: topAwaiting,
    },
    stewardHeld: {
      count: stewardHeldRows.length,
      items: stewardHeldItems,
    },
    humanHeld: {
      count: humanHeldRows.length,
      items: humanHeldItems,
    },
    unsignedBillsCount: openBills.length,
    pendingVerificationsCount: pendingVerifs.length,
    problems,
  };
}

/**
 * Loads today's factual activity: payments made today, invoices due today, decisions made today (Decision A14).
 */
export async function loadToday(
  db: Database,
  _client: PublicClient,
  _cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<TodaySummary> {
  await requireMember(db, user.id, businessId, ...VIEW_ROLES);

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  // 1. Payments made today (from chainEvents with eventName = 'Paid' from this Vault)
  const [biz] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1);

  let paymentsCount = 0;
  let paymentsTotal = 0n;
  if (biz?.vault) {
    const vault = getAddress(biz.vault).toLowerCase();
    const paidEvents = await db
      .select({ args: chainEvents.args })
      .from(chainEvents)
      .where(
        and(
          eq(chainEvents.address, vault),
          eq(chainEvents.eventName, "Paid"),
          gte(chainEvents.createdAt, startOfToday),
        ),
      );

    paymentsCount = paidEvents.length;
    for (const pe of paidEvents) {
      const args = pe.args as Record<string, unknown>;
      if (typeof args.paid === "string") {
        paymentsTotal += BigInt(args.paid);
      }
    }
  }

  // 2. Invoices scheduled/due today
  const dueTodayRows = await db
    .select({ fingerprint: invoices.fingerprint })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        gte(invoices.dueDate, startOfToday),
        lte(invoices.dueDate, endOfToday),
        inArray(invoices.status, ["scheduled", "verified"]),
      ),
    );

  // 3. Decisions made today
  const decisionsTodayRows = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        gte(decisions.createdAt, startOfToday),
      ),
    );

  return {
    paymentsCount,
    paymentsAmountFormatted: formatAmount(paymentsTotal, 6),
    scheduledCount: dueTodayRows.length,
    decisionsCount: decisionsTodayRows.length,
    asOfTime: now,
  };
}

/**
 * Loads the "Ahead" summary for the home screen (Decision T14).
 * Upcoming invoices, shortfalls, and runway statement.
 */
export async function loadAhead(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<AheadSummary> {
  await requireMember(db, user.id, businessId, ...VIEW_ROLES);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz || !biz.vault) {
    return {
      upcomingInvoices: [],
      shortfalls: [],
      runwayStatement: "No Vault created yet.",
    };
  }

  const vault = getAddress(biz.vault);
  const usdcToken = cfg.deployment.tokens.usdc;
  const eurcToken = cfg.deployment.tokens.eurc;

  const balances = await Promise.allSettled([usdcToken, eurcToken].map(address => client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [vault] })));
  const usdcBal = balances[0]?.status === "fulfilled" ? balances[0].value : null;
  const eurcBal = balances[1]?.status === "fulfilled" ? balances[1].value : null;

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
    )
    .orderBy(invoices.dueDate);

  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const flows = unpaid.map((inv) => {
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

  const usdcAddress = usdcToken.toLowerCase();
  const eurcAddress = eurcToken.toLowerCase();

  const balancesMap = new Map<string, bigint>();
  if (usdcBal !== null) balancesMap.set(usdcAddress, usdcBal);
  if (eurcBal !== null) balancesMap.set(eurcAddress, eurcBal);

  const rawShortfalls = tokenShortfalls(balancesMap, flows.filter(f => balancesMap.has(f.token)), nowSec, biz.bufferDays ?? 30);
  const shortfallsList = rawShortfalls.map((s) => {
    const isEurc = s.token === eurcAddress;
    const symbol = isEurc ? "EURC" : s.token === usdcAddress ? "USDC" : "Unknown token";
    const invs = flows.filter((f) => f.token === s.token && s.refs.includes(f.ref));
    return {
      tokenSymbol: symbol,
      shortFormatted: formatAmount(s.short, 6),
      dueFormatted: formatAmount(s.due, 6),
      earliestDueDate: invs[0] ? invs[0].dueDate : null,
    };
  });

  let runwayStatement: string;
  if (usdcBal === null || eurcBal === null || flows.some(f => !balancesMap.has(f.token))) {
    runwayStatement = "Cash coverage unavailable: one or more token balances could not be read.";
  } else if (shortfallsList.length) {
    runwayStatement = `${shortfallsList.map(s => s.tokenSymbol).join(" and ")} cash runs short within the selected ${biz.bufferDays ?? 30}-day buffer.`;
  } else {
    runwayStatement = `USDC and EURC cash cover recorded bills in the selected ${biz.bufferDays ?? 30}-day buffer.`;
  }

  const upcomingInvoices = unpaid.slice(0, 5).map((inv) => ({
    fingerprint: inv.fingerprint,
    invoiceNumber: inv.invoiceNumber,
    vendorName: inv.vendorName || inv.vendorHandle || inv.seal,
    amountFormatted: formatAmount(inv.total > inv.credited ? inv.total - inv.credited : 0n, 6),
    dueDate: inv.dueDate,
    token: inv.token.toLowerCase() === eurcAddress ? "EURC" : inv.token.toLowerCase() === usdcAddress ? "USDC" : "Unknown token",
  }));

  return {
    upcomingInvoices,
    shortfalls: shortfallsList,
    runwayStatement,
  };
}
