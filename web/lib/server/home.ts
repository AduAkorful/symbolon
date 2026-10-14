import "server-only";

import { notPreparedPayment } from "./prepared-payment";
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
import { symbolonContracts } from "@symbolon/chain";
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
  /** Open invoices that can't move until the owner does something about the vendor or the Vault (plan 05zj C, SYM-06) */
  waitingOnYou: {
    count: number;
    groups: Array<{
      kind: "verify_vendor" | "add_payee" | "screen" | "resume";
      title: string;
      href: string;
      action: string;
      invoices: Array<{ fingerprint: string; invoiceNumber: string; vendorName: string }>;
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
  /** What is still owed on every unpaid invoice, per currency: the list below shows only the next few, so this is what reconciles with a shortfall (plan 05zl, QA retest 2) */
  dueTotals: Array<{ tokenSymbol: string; totalFormatted: string; count: number }>;
  /** Unpaid invoices not in the list below */
  moreCount: number;
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

const WAITING_LIMIT = 40;
const WAITING_SEALS = 12;

/**
 * Open invoices stopped by something only a person can do: verify the vendor, add them as a payee, screen their payout address,
 * resume a paused Vault. Waiting out the new-payee period is not here: there is nothing to do. The first reason that applies wins,
 * so an invoice is in one group. Reads are bounded (a handful of vendors); a read that fails is said, never read as "all clear".
 */
async function loadWaitingOnYou(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  businessId: string,
  vault: string | null,
  problems: string[],
): Promise<NeedsYouSummary["waitingOnYou"]> {
  const empty: NeedsYouSummary["waitingOnYou"] = { count: 0, groups: [] };
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), inArray(invoices.status, ["received", "verified", "scheduled"])))
    .orderBy(desc(invoices.receivedAt))
    .limit(WAITING_LIMIT);
  if (rows.length === 0) return empty;

  const payeeRows = await db.select({ seal: payees.seal, status: payees.status }).from(payees).where(eq(payees.businessId, businessId));
  const statusOf = new Map(payeeRows.map((p) => [p.seal.toLowerCase(), p.status]));

  const label = (row: (typeof rows)[number]) => {
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      return { fingerprint: row.fingerprint, invoiceNumber: decoded.document.invoiceNumber, vendorName: decoded.document.vendor.name };
    } catch {
      unreadable(problems, row.fingerprint);
      return { fingerprint: row.fingerprint, invoiceNumber: row.invoiceNumber ?? `${row.fingerprint.slice(0, 10)}…`, vendorName: UNREADABLE_VENDOR };
    }
  };

  const groups = new Map<NeedsYouSummary["waitingOnYou"]["groups"][number]["kind"], NeedsYouSummary["waitingOnYou"]["groups"][number]>();
  const put = (kind: "verify_vendor" | "add_payee" | "screen" | "resume", title: string, href: string, action: string, row: (typeof rows)[number]) => {
    const group = groups.get(kind) ?? { kind, title, href, action, invoices: [] };
    group.invoices.push(label(row));
    groups.set(kind, group);
  };

  // what the chain says: needed only for vendors we have verified (an unverified one is waiting on the person already)
  const verifiedSeals = [...new Set(rows.map((r) => r.seal.toLowerCase()).filter((seal) => statusOf.get(seal) === "verified"))].slice(0, WAITING_SEALS);
  let paused = false;
  let screeningMaxAge = 0n;
  let now = 0n;
  const onchain = new Map<string, { exists: boolean; screenedAt: bigint }>();
  let chainOk = true;
  if (vault) {
    try {
      const contracts = symbolonContracts(client, cfg.deployment);
      const v = getAddress(vault);
      const [state, block] = await Promise.all([contracts.lens.read.getVaultState([v]), client.getBlock()]);
      paused = state.paused;
      screeningMaxAge = state.policy.screeningMaxAge;
      now = block.timestamp;
      await Promise.all(
        verifiedSeals.map(async (seal) => {
          const p = await contracts.lens.read.getPayee([v, getAddress(seal)]);
          onchain.set(seal, { exists: p.exists, screenedAt: p.screenedAt });
        }),
      );
    } catch {
      chainOk = false;
      problems.push("Can't confirm which invoices are waiting on you right now. Arc isn't answering.");
    }
  }

  for (const row of rows) {
    const seal = row.seal.toLowerCase();
    const status = statusOf.get(seal);
    if (status === "blocked" || status === "retired") continue; // the owner's own decision
    if (status !== "verified") {
      put("verify_vendor", "Verify the vendor", `/business/vendors/${seal}`, "Open the vendor", row);
      continue;
    }
    if (!chainOk || !vault) continue;
    const chain = onchain.get(seal);
    if (chain && !chain.exists) {
      put("add_payee", "Set the vendor up as a payee", `/business/vendors/${seal}`, "Open the vendor", row);
    } else if (chain && screeningMaxAge > 0n && (chain.screenedAt === 0n || now > chain.screenedAt + screeningMaxAge)) {
      put("screen", "Screen the vendor's payout address", "/business/compliance", "Open Compliance", row);
    } else if (paused) {
      put("resume", "Resume payments", "/business/steward", "Open the Steward", row);
    }
  }

  const list = [...groups.values()];
  return { count: list.reduce((n, g) => n + g.invoices.length, 0), groups: list };
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
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint), notPreparedPayment))
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
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint), notPreparedPayment))
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

  const waitingOnYou = await loadWaitingOnYou(db, client, cfg, businessId, biz.vault, problems).catch((e) => {
    console.error("waiting-on-you read failed", e);
    problems.push("Can't work out which invoices are waiting on you right now.");
    return { count: 0, groups: [] } as NeedsYouSummary["waitingOnYou"];
  });

  return {
    awaitingApproval: {
      count: awaitingRows.length,
      top: topAwaiting,
    },
    waitingOnYou,
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
        notPreparedPayment,
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
      dueTotals: [],
      moreCount: 0,
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

  const symbolOf = (token: string) => (token.toLowerCase() === eurcAddress ? "EURC" : token.toLowerCase() === usdcAddress ? "USDC" : "Unknown token");
  const totals = new Map<string, { raw: bigint; count: number }>();
  for (const inv of unpaid) {
    const owed = inv.total > inv.credited ? inv.total - inv.credited : 0n;
    const key = symbolOf(inv.token);
    const cur = totals.get(key) ?? { raw: 0n, count: 0 };
    totals.set(key, { raw: cur.raw + owed, count: cur.count + 1 });
  }
  const dueTotals = [...totals].map(([tokenSymbol, t]) => ({ tokenSymbol, totalFormatted: formatAmount(t.raw, 6), count: t.count }));
  const SHOWN = 8;
  // soonest first within each currency, so a list under a EURC shortfall is EURC bills and no other (QA retest 4); an invoice with
  // nothing left to pay is never listed
  const owing = unpaid.filter((inv) => inv.total > inv.credited);
  const soonest = [...owing].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const perToken = new Map<string, number>();
  const shownInvoices = soonest.filter((inv) => {
    const key = symbolOf(inv.token);
    const n = perToken.get(key) ?? 0;
    perToken.set(key, n + 1);
    return n < SHOWN;
  });
  shownInvoices.sort((a, b) => symbolOf(a.token).localeCompare(symbolOf(b.token)) || a.dueDate.getTime() - b.dueDate.getTime());

  const upcomingInvoices = shownInvoices.map((inv) => ({
    fingerprint: inv.fingerprint,
    invoiceNumber: inv.invoiceNumber,
    vendorName: inv.vendorName || inv.vendorHandle || inv.seal,
    amountFormatted: formatAmount(inv.total - inv.credited, 6),
    dueDate: inv.dueDate,
    token: symbolOf(inv.token),
  }));

  return {
    dueTotals,
    moreCount: Math.max(0, owing.length - upcomingInvoices.length),
    upcomingInvoices,
    shortfalls: shortfallsList,
    runwayStatement,
  };
}
