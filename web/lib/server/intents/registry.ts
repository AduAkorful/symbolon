import "server-only";
import type { IntentDescriptor } from "@symbolon/steward";
import {
  awaitingApprovalIntent,
  cashPositionIntent,
  earlyPaySavingsIntent,
  heldInvoicesIntent,
  paymentsDueIntent,
  recentPaymentsIntent,
  reserveStatusIntent,
  stewardStatusIntent,
  whyDecisionIntent,
} from "./executors";
import {
  budgetRemainingIntent,
  openOffersIntent,
  openOrdersIntent,
  pendingChangesIntent,
  policySummaryIntent,
  screeningStatusIntent,
  treasuryMovesIntent,
  vendorSummaryIntent,
} from "./topics";
import type { AskedAnswer, IntentContext, IntentHandler } from "./types";

export const INTENT_HANDLERS: Record<string, IntentHandler> = {
  payments_due: paymentsDueIntent,
  recent_payments: recentPaymentsIntent,
  held_invoices: heldInvoicesIntent,
  awaiting_approval: awaitingApprovalIntent,
  cash_position: cashPositionIntent,
  steward_status: stewardStatusIntent,
  reserve_status: reserveStatusIntent,
  early_pay_savings: earlyPaySavingsIntent,
  why_decision: whyDecisionIntent,
  vendor_summary: vendorSummaryIntent,
  open_offers: openOffersIntent,
  budget_remaining: budgetRemainingIntent,
  treasury_moves: treasuryMovesIntent,
  open_orders: openOrdersIntent,
  pending_changes: pendingChangesIntent,
  policy_summary: policySummaryIntent,
  screening_status: screeningStatusIntent,
};

export const QUICK_QUESTIONS = [
  { label: "What are we paying this week?", intent: "payments_due", params: { days: 7 } },
  { label: "Why are any invoices held?", intent: "held_invoices", params: {} },
  { label: "What is our cash runway and position?", intent: "cash_position", params: {} },
  { label: "What is the Steward's status?", intent: "steward_status", params: {} },
  { label: "How much has Early Pay saved?", intent: "early_pay_savings", params: {} },
  { label: "What payments were settled recently?", intent: "recent_payments", params: { days: 30 } },
  { label: "Any Early Pay offers waiting?", intent: "open_offers", params: {} },
  { label: "How much is left in our budgets?", intent: "budget_remaining", params: {} },
  { label: "Which orders are still open?", intent: "open_orders", params: {} },
  { label: "Are any changes waiting?", intent: "pending_changes", params: {} },
];

export function listIntentDescriptors(): IntentDescriptor[] {
  return Object.values(INTENT_HANDLERS).map((h) => h.descriptor);
}

export function getIntentHandler(name: string): IntentHandler | undefined {
  return INTENT_HANDLERS[name];
}

export async function executeIntent(
  ctx: IntentContext,
  name: string,
  params: Record<string, unknown> = {},
): Promise<AskedAnswer> {
  const handler = getIntentHandler(name);
  if (!handler) {
    const available = Object.keys(INTENT_HANDLERS).map((k) => k.replace(/_/g, " ")).join(", ");
    return {
      text: `I cannot answer that question yet. I can answer questions about: ${available}. Try one of the suggestions below.`,
      links: [],
      source: "From: Steward intent router",
      intent: "unsupported",
      params: {},
    };
  }
  // report only the parameters the intent declares, of the declared type
  const declared = handler.descriptor.params ?? {};
  const ran: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    const d = declared[k];
    if (d && typeof v === (d.type === "number" ? "number" : d.type === "boolean" ? "boolean" : "string")) ran[k] = v;
  }
  return { ...(await handler.execute(ctx, params)), params: ran };
}
