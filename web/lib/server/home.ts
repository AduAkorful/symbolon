import "server-only";

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

import { requireMember, type Role } from "./access";
import type { ChainSettings } from "./business";
import { summarizeDecision } from "./decision-text";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { feeBalance, type StewardConfig } from "./steward-runtime";
import { readVaultState, stewardStanding } from "./vault-read";

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];

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
  asOfBlock?: string;
  asOfTime: Date;
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

  // 1. Awaiting approval invoices (count + top 5)
  const awaitingRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "awaiting_approval")))
    .orderBy(desc(invoices.receivedAt));

  const topAwaiting: NeedsYouSummary["awaitingApproval"]["top"] = [];
  for (const row of awaitingRows.slice(0, 5)) {
    let vendorName = "Unknown vendor";
    let invoiceNumber = row.invoiceNumber ?? "Unknown";
    let token = "USDC";
    let amountStr = row.total.toString();
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
      token = decoded.document.currency.symbol;
      amountStr = formatAmount(row.total, decoded.document.currency.decimals);
    } catch {
      // fallback
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
    let vendorName = "Unknown vendor";
    let invoiceNumber = row.invoiceNumber ?? "Unknown";
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
    } catch {
      // fallback
    }

    const [latestDec] = await db
      .select({ record: decisions.record })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);

    const reason = String((latestDec?.record as any)?.rule ?? "Held by Steward pass");

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
    let vendorName = "Unknown vendor";
    let invoiceNumber = row.invoiceNumber ?? "Unknown";
    try {
      const decoded = decodeSealedInvoice(row.envelope);
      vendorName = decoded.document.vendor.name;
      invoiceNumber = decoded.document.invoiceNumber;
    } catch {
      // fallback
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
  const problems: string[] = [];

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
    problems.push(`Last Steward pass failed: ${lastRun.error ?? "unknown error"}`);
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

  let asOfBlock: string | undefined;
  try {
    const b = await _client.getBlockNumber();
    asOfBlock = b.toString();
  } catch {
    // client may fail or be stubbed without block
  }

  return {
    paymentsCount,
    paymentsAmountFormatted: formatAmount(paymentsTotal, 6),
    scheduledCount: dueTodayRows.length,
    decisionsCount: decisionsTodayRows.length,
    asOfBlock,
    asOfTime: now,
  };
}
