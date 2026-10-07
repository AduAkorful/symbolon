import "server-only";
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { decisions, earlyPayOffers, invoices, payees, queuedChanges, screenings, seals } from "@symbolon/db";
import { summarizeDecision } from "../decision-text";
import { listBudgets } from "../budgets";
import { listOrders } from "../orders";
import { loadPolicyView } from "../policy-edit";
import { resolveVendors, type VendorMatch } from "./resolve";
import { currencyTotals } from "./settlements";
import type { IntentAnswer, IntentContext, IntentHandler } from "./types";

// Plan 05y Part C. Every handler here only reads; each answer is a sentence built from what was read, and says where from.

const day = (d: Date) => d.toISOString().slice(0, 10);
const stamp = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
const OPEN_STATUSES = ["verified", "held", "awaiting_approval", "scheduled", "partially_paid"] as const;
const RISK_WORDS = ["low", "medium", "high", "blocked"] as const;

function needVendor(vendor: string | undefined, intent: string, now: Date): IntentAnswer | null {
  if (vendor) return null;
  return { text: "Which vendor? Name it, for example “Studio Ana”.", links: [["Vendors", "/business/vendors"]], source: `From: question at ${stamp(now)}`, intent };
}

/** Zero, one or several vendors for a name: the answer to give when it isn't exactly one, or the vendor */
async function oneVendor(ctx: IntentContext, text: string, intent: string, now: Date): Promise<{ vendor: VendorMatch } | { answer: IntentAnswer }> {
  const found = await resolveVendors(ctx, text);
  if (found.length === 1) return { vendor: found[0]! };
  if (found.length === 0) {
    return { answer: { text: `I couldn't find a vendor called “${text}” for this business.`, links: [["Vendors", "/business/vendors"]], source: `From: vendor records at ${stamp(now)}`, intent } };
  }
  return {
    answer: {
      text: `Several vendors match “${text}”: ${found.slice(0, 5).map((v) => v.name).join(", ")}. Name one of them.`,
      links: found.slice(0, 5).map((v) => [v.name, `/business/vendors/${v.seal}`] as [string, string]),
      source: `From: vendor records at ${stamp(now)}`,
      intent,
    },
  };
}

const vendorParam = (description: string, required: boolean) => ({ vendor: { type: "string", description, required } });

// ─── vendor_summary ──────────────────────────────────────────────────────────

export const vendorSummaryIntent: IntentHandler = {
  descriptor: { name: "vendor_summary", description: "Where one vendor stands: verification, invoices paid and open, next due date", params: vendorParam("Vendor name, handle or Seal address", true) },
  async execute(ctx, params) {
    const now = ctx.now ?? new Date();
    const text = typeof params.vendor === "string" ? params.vendor.trim() : "";
    const missing = needVendor(text, "vendor_summary", now);
    if (missing) return missing;
    const r = await oneVendor(ctx, text, "vendor_summary", now);
    if ("answer" in r) return r.answer;
    const { vendor } = r;

    const rows = await ctx.db
      .select({ status: invoices.status, token: invoices.token, total: invoices.total, credited: invoices.credited, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.businessId, ctx.businessId), sql`lower(${invoices.seal}) = ${vendor.seal.toLowerCase()}`));
    const open = rows.filter((x) => (OPEN_STATUSES as readonly string[]).includes(x.status));
    const paid = rows.filter((x) => x.status === "paid").length;
    const next = open.map((x) => x.dueDate).sort((a, b) => a.getTime() - b.getTime())[0];

    const standing =
      vendor.status === "verified" ? `verified${vendor.verifiedAt ? ` on ${day(vendor.verifiedAt)}` : ""}` : vendor.status === "blocked" ? "blocked" : "not verified yet";
    const openText = open.length === 0 ? "nothing open" : `${open.length} open for ${currencyTotals(ctx, open.map((x) => ({ token: x.token, amount: x.total - x.credited })))}${next ? `, next due ${day(next)}` : ""}`;
    return {
      text: `${vendor.name} is ${standing}. ${paid} invoice${paid === 1 ? "" : "s"} paid, ${openText}.`,
      links: [[`${vendor.name}`, `/business/vendors/${vendor.seal}`]],
      source: `From: this business's vendor and invoice records at ${stamp(now)}`,
      intent: "vendor_summary",
    };
  },
};

// ─── open_offers ─────────────────────────────────────────────────────────────

const percent = (bps: number) => `${bps / 100}%`;

export const openOffersIntent: IntentHandler = {
  descriptor: { name: "open_offers", description: "Early Pay offers from vendors that are open or countered right now", params: {} },
  async execute(ctx) {
    const now = ctx.now ?? new Date();
    const rows = await ctx.db
      .select({
        invoice: invoices.fingerprint,
        number: invoices.invoiceNumber,
        vendor: seals.displayName,
        bps: earlyPayOffers.discountBps,
        until: earlyPayOffers.validUntil,
        status: earlyPayOffers.status,
      })
      .from(earlyPayOffers)
      .innerJoin(invoices, eq(invoices.fingerprint, earlyPayOffers.fingerprint))
      .leftJoin(seals, eq(seals.address, invoices.seal))
      .where(and(eq(invoices.businessId, ctx.businessId), inArray(earlyPayOffers.status, ["open", "countered"]), gt(earlyPayOffers.validUntil, now)))
      .orderBy(earlyPayOffers.validUntil);
    const text =
      rows.length === 0
        ? "No Early Pay offers are open right now."
        : `${rows.length} Early Pay offer${rows.length === 1 ? " is" : "s are"} open: ${rows
            .slice(0, 5)
            .map((o) => `${o.vendor ?? "a vendor"}, invoice ${o.number ?? o.invoice.slice(0, 8)}, ${percent(o.bps)} off${o.status === "countered" ? " (countered)" : ""}, valid until ${day(o.until)}`)
            .join("; ")}.`;
    return {
      text,
      links: rows.slice(0, 5).map((o) => [`Invoice ${o.number ?? o.invoice.slice(0, 8)}`, `/business/inbox/${o.invoice}`] as [string, string]),
      source: `From: Early Pay offer records at ${stamp(now)}`,
      intent: "open_offers",
    };
  },
};

// ─── budget_remaining ────────────────────────────────────────────────────────

export const budgetRemainingIntent: IntentHandler = {
  descriptor: { name: "budget_remaining", description: "How much is left in each budget, or one named budget, this period", params: { budget: { type: "string", description: "Budget name; leave empty for all", required: false } } },
  async execute(ctx, params) {
    const now = ctx.now ?? new Date();
    const wanted = typeof params.budget === "string" ? params.budget.trim().toLowerCase() : "";
    try {
      if (!ctx.userId) throw new Error("no user for the budget read");
      const { budgets } = await listBudgets(ctx.db, ctx.client, ctx.deployment, { id: ctx.userId }, ctx.businessId);
      const shown = wanted ? budgets.filter((b) => b.name.toLowerCase().includes(wanted)) : budgets;
      if (shown.length === 0) return { text: `I couldn't find a budget called “${params.budget}”.`, links: [["Budgets", "/business/policy"]], source: `From: Vault budgets at ${stamp(now)}`, intent: "budget_remaining" };
      return {
        text: shown.map((b) => `${b.name}: ${b.remaining} left of ${b.cap} (${b.periodLengthLabel})`).join("; ") + ".",
        links: [["Budgets and policy", "/business/policy"]],
        source: `From: Vault budgets at ${stamp(now)}`,
        intent: "budget_remaining",
      };
    } catch (e) {
      console.error("ask: an intent could not read its data", e);
      return { text: "Can't confirm the budgets right now. Try again shortly.", links: [["Budgets and policy", "/business/policy"]], source: "From: failed chain read", intent: "budget_remaining" };
    }
  },
};

// ─── treasury_moves ──────────────────────────────────────────────────────────

const TREASURY_KINDS = ["withdrawn", "eurc_conversion", "sweep", "redeem"];

export const treasuryMovesIntent: IntentHandler = {
  descriptor: { name: "treasury_moves", description: "Withdrawals, conversions and reserve moves in the last N days", params: { days: { type: "number", description: "Days back (1-90, default 30)", required: false } } },
  async execute(ctx, params) {
    const now = ctx.now ?? new Date();
    const asked = typeof params.days === "number" && Number.isFinite(params.days) ? Math.trunc(params.days) : 30;
    const days = Math.min(90, Math.max(1, asked));
    const since = new Date(now.getTime() - days * 86_400_000);
    const rows = await ctx.db
      .select({ id: decisions.id, kind: decisions.kind, record: decisions.record, at: decisions.createdAt })
      .from(decisions)
      .where(and(eq(decisions.businessId, ctx.businessId), inArray(decisions.kind, TREASURY_KINDS), gte(decisions.createdAt, since)))
      .orderBy(desc(decisions.createdAt))
      .limit(50);
    const text =
      rows.length === 0
        ? `No withdrawals, conversions or reserve moves were recorded in the last ${days} days.`
        : `${rows.length} treasury move${rows.length === 1 ? "" : "s"} in the last ${days} days. Latest: ${rows
            .slice(0, 5)
            .map((r) => `${day(r.at)}, ${summarizeDecision(r.record as Record<string, unknown>).sentence}`)
            .join("; ")}.`;
    return {
      text,
      links: [["Treasury", "/business/treasury"], ...(rows[0] ? [["Latest decision", `/business/decisions/${rows[0].id}`] as [string, string]] : [])],
      source: `From: decision records at ${stamp(now)}`,
      intent: "treasury_moves",
    };
  },
};

// ─── open_orders ─────────────────────────────────────────────────────────────

export const openOrdersIntent: IntentHandler = {
  descriptor: { name: "open_orders", description: "Open purchase orders and what is left on them, optionally for one vendor", params: vendorParam("Vendor name; leave empty for all", false) },
  async execute(ctx, params) {
    const now = ctx.now ?? new Date();
    const text = typeof params.vendor === "string" ? params.vendor.trim() : "";
    let seal: string | undefined;
    let scope = "";
    if (text) {
      const r = await oneVendor(ctx, text, "open_orders", now);
      if ("answer" in r) return r.answer;
      seal = r.vendor.seal.toLowerCase();
      scope = `For ${r.vendor.name}: `;
    }
    try {
      if (!ctx.userId) throw new Error("no user for the order read");
      const all = await listOrders(ctx.db, ctx.client, ctx.deployment, { id: ctx.userId }, ctx.businessId);
      const open = all.filter((o) => !o.closedAt && (!seal || o.seal.toLowerCase() === seal));
      if (open.length === 0) return { text: seal ? `${scope}no open purchase orders.` : "There are no open purchase orders.", links: [["Orders", "/business/orders"]], source: `From: orders and the Vault at ${stamp(now)}`, intent: "open_orders" };
      const line = (o: (typeof open)[number]) =>
        `${o.poNumber}${o.vendorName ? ` (${o.vendorName})` : ""}: ${o.live.ok && o.live.remaining !== undefined ? `${o.live.remaining} left` : "remaining can't be confirmed right now"}`;
      return {
        text: `${scope}${open.length} open order${open.length === 1 ? "" : "s"}. ${open.slice(0, 5).map(line).join("; ")}.`,
        links: [["Orders", "/business/orders"]],
        source: `From: orders and the Vault at ${stamp(now)}`,
        intent: "open_orders",
      };
    } catch (e) {
      console.error("ask: an intent could not read its data", e);
      return { text: "Can't confirm the orders right now. Try again shortly.", links: [["Orders", "/business/orders"]], source: "From: failed read", intent: "open_orders" };
    }
  },
};

// ─── pending_changes ─────────────────────────────────────────────────────────

export const pendingChangesIntent: IntentHandler = {
  descriptor: { name: "pending_changes", description: "Policy and setting changes that are queued and waiting out their delay", params: {} },
  async execute(ctx) {
    const now = ctx.now ?? new Date();
    const rows = await ctx.db.select().from(queuedChanges).where(and(eq(queuedChanges.businessId, ctx.businessId), eq(queuedChanges.status, "queued"))).orderBy(queuedChanges.eta);
    const text =
      rows.length === 0
        ? "No changes are waiting."
        : `${rows.length} change${rows.length === 1 ? " is" : "s are"} waiting: ${rows
            .slice(0, 5)
            .map((c) => `${typeof c.summary?.title === "string" ? c.summary.title : c.kind}, ${c.eta.getTime() <= now.getTime() ? "ready to apply" : `can be applied from ${stamp(c.eta)}`}`)
            .join("; ")}.`;
    return { text, links: [["Policy and changes", "/business/policy"]], source: `From: queued change records at ${stamp(now)}`, intent: "pending_changes" };
  },
};

// ─── policy_summary ──────────────────────────────────────────────────────────

export const policySummaryIntent: IntentHandler = {
  descriptor: { name: "policy_summary", description: "The Vault's payment policy in plain words: limits, approval thresholds and delays", params: {} },
  async execute(ctx) {
    const now = ctx.now ?? new Date();
    try {
      if (!ctx.userId) throw new Error("no user for the policy read");
      const view = await loadPolicyView(ctx.db, ctx.client, ctx.deployment, { id: ctx.userId }, ctx.businessId);
      return { text: view.lines.join(" "), links: [["Policy", "/business/policy"]], source: `From: the Vault's policy at ${stamp(now)}`, intent: "policy_summary" };
    } catch (e) {
      console.error("ask: an intent could not read its data", e);
      return { text: "Can't confirm the policy right now. Try again shortly.", links: [["Policy", "/business/policy"]], source: "From: failed chain read", intent: "policy_summary" };
    }
  },
};

// ─── screening_status ────────────────────────────────────────────────────────

export const screeningStatusIntent: IntentHandler = {
  descriptor: { name: "screening_status", description: "Which payees have been screened, and their risk level, optionally for one vendor", params: vendorParam("Vendor name; leave empty for all", false) },
  async execute(ctx, params) {
    const now = ctx.now ?? new Date();
    const text = typeof params.vendor === "string" ? params.vendor.trim() : "";
    let only: VendorMatch | undefined;
    let label = "";
    if (text) {
      const r = await oneVendor(ctx, text, "screening_status", now);
      if ("answer" in r) return r.answer;
      only = r.vendor;
      label = `For ${r.vendor.name}: `;
    }
    const vendors = await ctx.db
      .select({ seal: payees.seal, name: seals.displayName })
      .from(payees)
      .leftJoin(seals, eq(seals.address, payees.seal))
      .where(eq(payees.businessId, ctx.businessId));
    const rows = await ctx.db.select().from(screenings).where(eq(screenings.businessId, ctx.businessId)).orderBy(desc(screenings.screenedAt));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.seal.toLowerCase())) latest.set(r.seal.toLowerCase(), r);

    const scope = only ? vendors.filter((v) => v.seal.toLowerCase() === only!.seal.toLowerCase()) : vendors;
    if (scope.length === 0) return { text: "There are no payees to screen yet.", links: [["Compliance", "/business/compliance"]], source: `From: screening records at ${stamp(now)}`, intent: "screening_status" };
    const screened = scope.filter((v) => latest.has(v.seal.toLowerCase()));
    const unscreened = scope.length - screened.length;
    const detail = screened
      .slice(0, 5)
      .map((v) => `${v.name ?? v.seal}: ${RISK_WORDS[latest.get(v.seal.toLowerCase())!.risk] ?? "unknown"} risk on ${day(latest.get(v.seal.toLowerCase())!.screenedAt)}`)
      .join("; ");
    return {
      text: `${label}${screened.length} of ${scope.length} payee${scope.length === 1 ? "" : "s"} screened${unscreened > 0 ? `, ${unscreened} not screened yet` : ""}.${detail ? ` ${detail}.` : ""}`,
      links: [["Compliance", "/business/compliance"]],
      source: `From: this business's screening records at ${stamp(now)}`,
      intent: "screening_status",
    };
  },
};
