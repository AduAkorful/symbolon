import "server-only";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { formatAmount } from "@symbolon/seal";
import { showAmount } from "@/lib/format";
import {
  businesses,
  chainEvents,
  decisions,
  invoices,
  members,
  stewardRuns,
  type Database,
} from "@symbolon/db";
import { summarizeDecision } from "../decision-text";
import { loadTreasury } from "../treasury";
import { readVaultState, stewardStanding } from "../vault-read";
import type { IntentAnswer, IntentContext, IntentHandler } from "./types";

function formatUsdc(units: bigint): string {
  return `${showAmount(formatAmount(units, 6))} USDC`;
}

async function resolveIntentUser(ctx: IntentContext): Promise<{ id: string } | null> {
  if (ctx.userId) return { id: ctx.userId };
  const [m] = await ctx.db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.businessId, ctx.businessId))
    .limit(1);
  return m ? { id: m.userId } : null;
}

// ─── 1. payments_due ─────────────────────────────────────────────────────────

export const paymentsDueIntent: IntentHandler = {
  descriptor: {
    name: "payments_due",
    description: "Upcoming invoices due within a given number of days",
    params: {
      days: { type: "number", description: "Number of days ahead (1-90, default 7)", required: false },
    },
  },
  async execute(ctx: IntentContext, params: Record<string, unknown>): Promise<IntentAnswer> {
    const days = Math.min(Math.max(Number(params.days ?? 7) || 7, 1), 90);
    const now = ctx.now ?? new Date();
    const cutoff = new Date(now.getTime() + days * 86_400_000);

    const rows = await ctx.db
      .select({
        fingerprint: invoices.fingerprint,
        invoiceNumber: invoices.invoiceNumber,
        total: invoices.total,
        credited: invoices.credited,
        dueDate: invoices.dueDate,
        envelope: invoices.envelope,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, ctx.businessId),
          lte(invoices.dueDate, cutoff),
          sql`${invoices.credited} < ${invoices.total}`,
        ),
      )
      .orderBy(invoices.dueDate)
      .limit(50);

    const remainingTotal = rows.reduce((acc, r) => acc + (r.total - r.credited), 0n);
    const count = rows.length;

    let text: string;
    if (count === 0) {
      text = `No payments are due in the next ${days} days.`;
    } else {
      text = `${count} invoice${count === 1 ? "" : "s"} totaling ${formatUsdc(remainingTotal)} due within the next ${days} days.`;
    }

    const links: [string, string][] = rows.slice(0, 5).map((r) => [
      `Invoice ${r.invoiceNumber ?? r.fingerprint.slice(0, 10)}`,
      `/business/inbox/${r.fingerprint}`,
    ]);

    return {
      text,
      links,
      source: `From: stored invoice records at ${now.toISOString().slice(0, 19)}Z`,
      intent: "payments_due",
    };
  },
};

// ─── 2. recent_payments ──────────────────────────────────────────────────────

export const recentPaymentsIntent: IntentHandler = {
  descriptor: {
    name: "recent_payments",
    description: "Recent settled payments and transactions in the last N days",
    params: {
      days: { type: "number", description: "Days to look back (1-90, default 30)", required: false },
    },
  },
  async execute(ctx: IntentContext, params: Record<string, unknown>): Promise<IntentAnswer> {
    const days = Math.min(Math.max(Number(params.days ?? 30) || 30, 1), 90);
    const now = ctx.now ?? new Date();
    const since = new Date(now.getTime() - days * 86_400_000);

    const settled = await ctx.db
      .select({
        fingerprint: invoices.fingerprint,
        invoiceNumber: invoices.invoiceNumber,
        credited: invoices.credited,
        receivedAt: invoices.receivedAt,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, ctx.businessId),
          gte(invoices.receivedAt, since),
          sql`${invoices.credited} > 0`,
        ),
      )
      .orderBy(desc(invoices.receivedAt))
      .limit(50);

    const count = settled.length;
    const totalPaid = settled.reduce((acc, r) => acc + r.credited, 0n);

    let text: string;
    if (count === 0) {
      text = `No payments were settled in the last ${days} days.`;
    } else {
      text = `${count} payment${count === 1 ? "" : "s"} totaling ${formatUsdc(totalPaid)} settled in the last ${days} days.`;
    }

    const links: [string, string][] = settled.slice(0, 5).map((r) => [
      `Receipt: ${r.invoiceNumber ?? r.fingerprint.slice(0, 10)}`,
      `/receipt/${r.fingerprint}`,
    ]);

    return {
      text,
      links,
      source: `From: settled ledger records at ${now.toISOString().slice(0, 19)}Z`,
      intent: "recent_payments",
    };
  },
};

// ─── 3. held_invoices ────────────────────────────────────────────────────────

export const heldInvoicesIntent: IntentHandler = {
  descriptor: {
    name: "held_invoices",
    description: "Invoices currently on hold by the Steward or a team member, with reasons",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    const now = ctx.now ?? new Date();
    const held = await ctx.db
      .select({
        fingerprint: invoices.fingerprint,
        invoiceNumber: invoices.invoiceNumber,
        holdSource: invoices.holdSource,
        total: invoices.total,
        receivedAt: invoices.receivedAt,
      })
      .from(invoices)
      .where(and(eq(invoices.businessId, ctx.businessId), eq(invoices.status, "held")))
      .orderBy(desc(invoices.receivedAt))
      .limit(20);

    const count = held.length;
    if (count === 0) {
      return {
        text: "There are currently no held invoices. All invoices in your inbox are flowing or resolved.",
        links: [],
        source: `From: inbox status at ${now.toISOString().slice(0, 19)}Z`,
        intent: "held_invoices",
      };
    }

    const stewardCount = held.filter((h) => h.holdSource === "steward").length;
    const humanCount = count - stewardCount;

    const summaryParts: string[] = [];
    if (stewardCount > 0) summaryParts.push(`${stewardCount} by the Steward`);
    if (humanCount > 0) summaryParts.push(`${humanCount} by your team`);

    const reasonsList: string[] = [];
    for (const h of held.slice(0, 3)) {
      const [latestDec] = await ctx.db
        .select({ record: decisions.record })
        .from(decisions)
        .where(and(eq(decisions.businessId, ctx.businessId), eq(decisions.subject, h.fingerprint)))
        .orderBy(desc(decisions.createdAt))
        .limit(1);
      const reason = String(
        (latestDec?.record as any)?.rule ??
          (h.holdSource === "human" ? "Held by delivery rejection" : "Under review"),
      );
      reasonsList.push(`${h.invoiceNumber ?? h.fingerprint.slice(0, 8)} (${reason})`);
    }

    const text = `${count} invoice${count === 1 ? "" : "s"} on hold (${summaryParts.join(", ")}): ${reasonsList.join("; ")}.`;
    const links: [string, string][] = held.slice(0, 5).map((h) => [
      `Review ${h.invoiceNumber ?? h.fingerprint.slice(0, 8)}`,
      `/business/inbox/${h.fingerprint}`,
    ]);

    return {
      text,
      links,
      source: `From: inbox holds at ${now.toISOString().slice(0, 19)}Z`,
      intent: "held_invoices",
    };
  },
};

// ─── 4. awaiting_approval ────────────────────────────────────────────────────

export const awaitingApprovalIntent: IntentHandler = {
  descriptor: {
    name: "awaiting_approval",
    description: "Invoices currently awaiting owner or approver signature",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    const now = ctx.now ?? new Date();
    const rows = await ctx.db
      .select({
        fingerprint: invoices.fingerprint,
        invoiceNumber: invoices.invoiceNumber,
        total: invoices.total,
        credited: invoices.credited,
      })
      .from(invoices)
      .where(and(eq(invoices.businessId, ctx.businessId), eq(invoices.status, "awaiting_approval")))
      .limit(50);

    const count = rows.length;
    if (count === 0) {
      return {
        text: "There are no invoices waiting for your approval right now.",
        links: [["Approvals queue", "/business/approvals"]],
        source: `From: approvals queue at ${now.toISOString().slice(0, 19)}Z`,
        intent: "awaiting_approval",
      };
    }

    const total = rows.reduce((acc, r) => acc + (r.total - r.credited), 0n);
    const text = `${count} invoice${count === 1 ? "" : "s"} totaling ${formatUsdc(total)} awaiting signature in the approvals queue.`;
    const links: [string, string][] = [
      ["Open approvals queue", "/business/approvals"],
      ...rows.slice(0, 3).map((r): [string, string] => [
        `Invoice ${r.invoiceNumber ?? r.fingerprint.slice(0, 8)}`,
        `/business/inbox/${r.fingerprint}`,
      ]),
    ];

    return {
      text,
      links,
      source: `From: approvals queue at ${now.toISOString().slice(0, 19)}Z`,
      intent: "awaiting_approval",
    };
  },
};

// ─── 5. cash_position ────────────────────────────────────────────────────────

export const cashPositionIntent: IntentHandler = {
  descriptor: {
    name: "cash_position",
    description: "Vault cash balances, EURC, USYC reserve, and forward runway",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    try {
      const user = await resolveIntentUser(ctx);
      if (!user) throw new Error("No user found");
      const treasury = await loadTreasury(ctx.db, ctx.client, ctx.deployment, ctx.businessId, user);
      const usdcFormatted = treasury.balances.usdc ? `${treasury.balances.usdc.amount} USDC` : "0.00 USDC";
      const eurcFormatted = treasury.balances.eurc ? `${treasury.balances.eurc.amount} EURC` : "0.00 EURC";
      const reserveFormatted = `${treasury.reserve.shares} USYC`;

      const runwayText = treasury.forecast.runwayDays !== null
        ? `${treasury.forecast.runwayDays} days of obligations covered`
        : "no upcoming obligations";

      const text = `Operating cash is ${usdcFormatted} and ${eurcFormatted}. Reserve holds ${reserveFormatted}. Forward runway: ${runwayText} (with a ${treasury.forecast.bufferDays}-day buffer).`;
      return {
        text,
        links: [["Treasury dashboard", "/business/treasury"]],
        source: `From: Vault and Reserve balances at block ${treasury.block}`,
        intent: "cash_position",
      };
    } catch {
      return {
        text: "Could not load onchain treasury balances right now. Verify Vault connectivity.",
        links: [["Treasury dashboard", "/business/treasury"]],
        source: "From: failed chain read",
        intent: "cash_position",
      };
    }
  },
};

// ─── 6. steward_status ───────────────────────────────────────────────────────

export const stewardStatusIntent: IntentHandler = {
  descriptor: {
    name: "steward_status",
    description: "Current Steward mode, operating status (active/paused), and last cycle result",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    const now = ctx.now ?? new Date();
    const [biz] = await ctx.db
      .select({
        stewardMode: businesses.stewardMode,
        stewardWallet: businesses.stewardWallet,
        vault: businesses.vault,
      })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId))
      .limit(1);

    if (!biz) {
      return {
        text: "Business record not found.",
        links: [],
        source: "From: db",
        intent: "steward_status",
      };
    }

    const [lastRun] = await ctx.db
      .select()
      .from(stewardRuns)
      .where(eq(stewardRuns.businessId, ctx.businessId))
      .orderBy(desc(stewardRuns.startedAt))
      .limit(1);

    let onchainStatus = "Not deployed";
    if (biz.vault) {
      try {
        const vState = await readVaultState(ctx.client, ctx.deployment, biz.vault);
        const standing = stewardStanding(biz.stewardWallet, vState);
        onchainStatus = standing.kind === "paused" ? "Paused" : standing.kind === "active" ? "Active" : "Not ready";
      } catch {
        onchainStatus = "Unreachable";
      }
    }

    const mode = biz.stewardMode ?? "shadow";
    const runInfo = lastRun
      ? `Last cycle completed with status '${lastRun.status}' at ${lastRun.finishedAt ? lastRun.finishedAt.toISOString().slice(11, 19) + "Z" : "in-progress"}.`
      : "No cycles have run yet.";

    const text = `The Steward is configured in ${mode} mode (onchain standing: ${onchainStatus}). ${runInfo}`;
    return {
      text,
      links: [["Steward control page", "/business/steward"]],
      source: `From: Steward standing & cycle log at ${now.toISOString().slice(0, 19)}Z`,
      intent: "steward_status",
    };
  },
};

// ─── 7. reserve_status ───────────────────────────────────────────────────────

export const reserveStatusIntent: IntentHandler = {
  descriptor: {
    name: "reserve_status",
    description: "Yield-bearing USYC reserve standing, policy caps, and oracle yield",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    try {
      const user = await resolveIntentUser(ctx);
      if (!user) throw new Error("No user found");
      const treasury = await loadTreasury(ctx.db, ctx.client, ctx.deployment, ctx.businessId, user);
      if (!treasury.reserve.enabled) {
        return {
          text: "The USYC treasury reserve is currently disabled for this Vault. Operating funds remain 100% in liquid USDC/EURC.",
          links: [["Enable Reserve in Treasury", "/business/treasury"]],
          source: `From: Vault reserve policy at block ${treasury.block}`,
          intent: "reserve_status",
        };
      }

      const balance = `${treasury.reserve.shares} USYC`;
      const yieldPct = treasury.reserve.yieldBps !== null ? `${(treasury.reserve.yieldBps / 100).toFixed(2)}%` : "N/A";
      const maxShare = `${(treasury.reserve.policy.maxReserveBps / 100).toFixed(0)}%`;

      const text = `USYC Reserve is active with ${balance}. Latest oracle round yield is ${yieldPct}. Allocation cap is ${maxShare} of liquid capital.`;
      return {
        text,
        links: [["Treasury Reserve Details", "/business/treasury"]],
        source: `From: USYC Teller & Oracle round at block ${treasury.block}`,
        intent: "reserve_status",
      };
    } catch {
      return {
        text: "Unable to read reserve standing from chain.",
        links: [["Treasury", "/business/treasury"]],
        source: "From: failed chain read",
        intent: "reserve_status",
      };
    }
  },
};

// ─── 8. early_pay_savings ────────────────────────────────────────────────────

export const earlyPaySavingsIntent: IntentHandler = {
  descriptor: {
    name: "early_pay_savings",
    description: "Total discount savings captured through Early Pay",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    const now = ctx.now ?? new Date();
    const rows = await ctx.db
      .select({
        total: invoices.total,
        credited: invoices.credited,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, ctx.businessId),
          sql`${invoices.credited} > 0`,
        ),
      );

    // Sum discounts where total > credited (vendor agreed to discount)
    const discountedRows = rows.filter((r) => r.total > r.credited);
    const count = discountedRows.length;
    const savings = discountedRows.reduce((acc, r) => acc + (r.total - r.credited), 0n);

    let text: string;
    if (count === 0) {
      text = "No Early Pay discounts have been settled yet. Once vendors accept early payment discounts, savings will accumulate here.";
    } else {
      text = `Early Pay has saved ${formatUsdc(savings)} across ${count} discounted payment${count === 1 ? "" : "s"}.`;
    }

    return {
      text,
      links: [["Early Pay Program", "/business/treasury"]],
      source: `From: settlement records at ${now.toISOString().slice(0, 19)}Z`,
      intent: "early_pay_savings",
    };
  },
};

// ─── 9. why_decision ─────────────────────────────────────────────────────────

export const whyDecisionIntent: IntentHandler = {
  descriptor: {
    name: "why_decision",
    description: "Reason why a particular invoice was paid, held, or queued",
    params: {
      invoice: { type: "string", description: "Invoice number or fingerprint", required: false },
    },
  },
  async execute(ctx: IntentContext, params: Record<string, unknown>): Promise<IntentAnswer> {
    const now = ctx.now ?? new Date();
    const target = typeof params.invoice === "string" ? params.invoice.trim() : "";

    if (!target) {
      // Return the most recent decision for the business
      const [latest] = await ctx.db
        .select()
        .from(decisions)
        .where(eq(decisions.businessId, ctx.businessId))
        .orderBy(desc(decisions.createdAt))
        .limit(1);

      if (!latest) {
        return {
          text: "No decision records have been created yet for this business.",
          links: [],
          source: `From: audit log at ${now.toISOString().slice(0, 19)}Z`,
          intent: "why_decision",
        };
      }

      const sum = summarizeDecision(latest.record as Record<string, unknown>);
      const fp = latest.subject ?? "";
      return {
        text: `Latest decision: ${sum.sentence}.`,
        links: [
          ["View decision detail", `/business/decisions/${latest.id}`],
          ...(fp ? [["View invoice in inbox", `/business/inbox/${fp}`] as [string, string]] : []),
        ],
        source: `From: decision ${latest.id.slice(0, 8)} at ${latest.createdAt.toISOString().slice(0, 19)}Z`,
        intent: "why_decision",
      };
    }

    // Match candidate invoices by fingerprint or invoiceNumber
    const candidates = await ctx.db
      .select({
        fingerprint: invoices.fingerprint,
        invoiceNumber: invoices.invoiceNumber,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, ctx.businessId),
          or(
            eq(invoices.fingerprint, target),
            sql`lower(${invoices.invoiceNumber}) = lower(${target})`,
          ),
        ),
      )
      .limit(5);

    if (candidates.length === 0) {
      return {
        text: `No invoice found matching '${target}'. Check the invoice number or fingerprint in your inbox.`,
        links: [["Open inbox", "/business/inbox"]],
        source: `From: search at ${now.toISOString().slice(0, 19)}Z`,
        intent: "why_decision",
      };
    }

    if (candidates.length > 1) {
      const list = candidates.map((c) => c.invoiceNumber ?? c.fingerprint.slice(0, 8)).join(", ");
      return {
        text: `Found multiple invoices matching '${target}': ${list}. Please specify the exact invoice number.`,
        links: candidates.map((c) => [
          `Invoice ${c.invoiceNumber ?? c.fingerprint.slice(0, 8)}`,
          `/business/inbox/${c.fingerprint}`,
        ]),
        source: `From: search at ${now.toISOString().slice(0, 19)}Z`,
        intent: "why_decision",
      };
    }

    const matched = candidates[0]!;
    const [dec] = await ctx.db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.businessId, ctx.businessId),
          eq(decisions.subject, matched.fingerprint),
        ),
      )
      .orderBy(desc(decisions.createdAt))
      .limit(1);

    if (!dec) {
      return {
        text: `Invoice ${matched.invoiceNumber ?? matched.fingerprint.slice(0, 8)} is in your records, but no Steward decision has evaluated it yet.`,
        links: [["View in inbox", `/business/inbox/${matched.fingerprint}`]],
        source: `From: inbox at ${now.toISOString().slice(0, 19)}Z`,
        intent: "why_decision",
      };
    }

    const sum = summarizeDecision(dec.record as Record<string, unknown>);
    return {
      text: `Invoice ${matched.invoiceNumber ?? matched.fingerprint.slice(0, 8)}: ${sum.sentence}.`,
      links: [
        ["View decision detail", `/business/decisions/${dec.id}`],
        ["View in inbox", `/business/inbox/${matched.fingerprint}`],
      ],
      source: `From: decision ${dec.id.slice(0, 8)} at ${dec.createdAt.toISOString().slice(0, 19)}Z`,
      intent: "why_decision",
    };
  },
};
