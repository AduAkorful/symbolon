import "server-only";

import { notPreparedPayment } from "./prepared-payment";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";

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
import { readErc20Balance, readVaultState, readVaultSummary, stewardStanding } from "./vault-read";

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

/** The latest recorded rule for each invoice, in one read. Missing means the caller supplies its own sentence. */
async function latestRules(db: Database, businessId: string, subjects: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (subjects.length === 0) return map;
  const rows = await db
    .selectDistinctOn([decisions.subject], { subject: decisions.subject, record: decisions.record })
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), inArray(decisions.subject, subjects), notPreparedPayment))
    .orderBy(decisions.subject, desc(decisions.createdAt));
  for (const row of rows) {
    if (!row.subject) continue;
    const rule = (row.record as { rule?: unknown } | null)?.rule;
    if (rule !== undefined && rule !== null) map.set(row.subject, String(rule));
  }
  return map;
}

function namedInvoice(row: { envelope: string; fingerprint: string; invoiceNumber: string | null }, problems: string[]) {
  let vendorName = UNREADABLE_VENDOR;
  let invoiceNumber = row.invoiceNumber ?? `${row.fingerprint.slice(0, 10)}…`;
  let token = "";
  let decimals = 6;
  try {
    const decoded = decodeSealedInvoice(row.envelope);
    vendorName = decoded.document.vendor.name;
    invoiceNumber = decoded.document.invoiceNumber;
    token = decoded.document.currency.symbol;
    decimals = decoded.document.currency.decimals;
  } catch {
    unreadable(problems, row.fingerprint);
  }
  return { vendorName, invoiceNumber, token, decimals };
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

  const [awaitingRows, stewardHeldRows, humanHeldRows, openBills, pendingVerifs, lastRunRows] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "awaiting_approval")))
      .orderBy(desc(invoices.receivedAt)),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "held"), or(eq(invoices.holdSource, "steward"), isNull(invoices.holdSource))))
      .orderBy(desc(invoices.receivedAt)),
    db
      .select()
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "held"), eq(invoices.holdSource, "human")))
      .orderBy(desc(invoices.receivedAt)),
    db.select({ id: unsignedBills.id }).from(unsignedBills).where(and(eq(unsignedBills.businessId, businessId), eq(unsignedBills.status, "open"))),
    db.select({ seal: payees.seal }).from(payees).where(and(eq(payees.businessId, businessId), eq(payees.status, "pending_verification"))),
    db.select().from(stewardRuns).where(eq(stewardRuns.businessId, businessId)).orderBy(desc(stewardRuns.startedAt)).limit(1),
  ]);

  const rules = await latestRules(db, businessId, [
    ...awaitingRows.slice(0, 5).map((row) => row.fingerprint),
    ...stewardHeldRows.slice(0, 5).map((row) => row.fingerprint),
  ]);

  const topAwaiting: NeedsYouSummary["awaitingApproval"]["top"] = awaitingRows.slice(0, 5).map((row) => {
    const named = namedInvoice(row, problems);
    return {
      fingerprint: row.fingerprint,
      invoiceNumber: named.invoiceNumber,
      vendorName: named.vendorName,
      amountFormatted: named.token ? formatAmount(row.total, named.decimals) : "—",
      token: named.token,
      ruleNeededHuman: rules.get(row.fingerprint) || "Approval required",
    };
  });

  const stewardHeldItems: NeedsYouSummary["stewardHeld"]["items"] = stewardHeldRows.slice(0, 5).map((row) => {
    const named = namedInvoice(row, problems);
    return {
      fingerprint: row.fingerprint,
      invoiceNumber: named.invoiceNumber,
      vendorName: named.vendorName,
      reason: rules.get(row.fingerprint) || "No reason was recorded for this hold",
    };
  });

  const humanHeldItems: NeedsYouSummary["humanHeld"]["items"] = humanHeldRows.slice(0, 5).map((row) => {
    const named = namedInvoice(row, problems);
    return { fingerprint: row.fingerprint, invoiceNumber: named.invoiceNumber, vendorName: named.vendorName };
  });

  const chainProblems: string[] = [];
  const waitProblems: string[] = [];
  const [waitingOnYou] = await Promise.all([
    loadWaitingOnYou(db, client, cfg, businessId, biz.vault, waitProblems).catch((e) => {
      console.error("waiting-on-you read failed", e);
      waitProblems.push("Can't work out which invoices are waiting on you right now.");
      return { count: 0, groups: [] } as NeedsYouSummary["waitingOnYou"];
    }),
    (async () => {
      if (!biz.vault) return;
      const vault = getAddress(biz.vault);
      const [state, bal] = await Promise.all([
        readVaultState(client, cfg.deployment, vault),
        biz.stewardMode !== "shadow" && biz.stewardWallet ? feeBalance(client, biz.stewardWallet) : null,
      ]);
      if (stewardStanding(biz.stewardWallet, state).kind === "mismatch") {
        chainProblems.push("The Steward this Vault reports onchain isn't the wallet configured for this business.");
      }
      // the Steward page's own floor: below 0.01 USDC (18-decimal native units) a run is skipped (QA SYM-21)
      if (bal !== null && bal < 10_000_000_000_000_000n) {
        chainProblems.push("The Steward's fee balance is below 0.01 USDC, so its runs will be skipped. Add fees on the Steward page.");
      }
    })(),
  ]);

  const lastRun = lastRunRows[0];
  if (lastRun && lastRun.status === "failed") {
    problems.push(`Last Steward pass failed: ${plainRunError(lastRun.error)}`);
  }
  problems.push(...chainProblems, ...waitProblems);

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

  const [[biz], dueTodayRows, decisionsTodayRows] = await Promise.all([
    db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1),
    db
      .select({ fingerprint: invoices.fingerprint })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, businessId),
          gte(invoices.dueDate, startOfToday),
          lte(invoices.dueDate, endOfToday),
          inArray(invoices.status, ["scheduled", "verified"]),
        ),
      ),
    db
      .select({ id: decisions.id })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), gte(decisions.createdAt, startOfToday), notPreparedPayment)),
  ]);

  let paymentsCount = 0;
  let paymentsTotal = 0n;
  if (biz?.vault) {
    const vault = getAddress(biz.vault).toLowerCase();
    const paidEvents = await db
      .select({ args: chainEvents.args })
      .from(chainEvents)
      .where(and(eq(chainEvents.address, vault), eq(chainEvents.eventName, "Paid"), gte(chainEvents.createdAt, startOfToday)));

    paymentsCount = paidEvents.length;
    for (const pe of paidEvents) {
      const args = pe.args as Record<string, unknown>;
      if (typeof args.paid === "string") paymentsTotal += BigInt(args.paid);
    }
  }

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

  const [summary, eurcBal] = await Promise.all([
    readVaultSummary(client, cfg.deployment, vault),
    readErc20Balance(client, eurcToken, vault),
  ]);
  const usdcBal = summary.ok ? summary.usdc : null;

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
