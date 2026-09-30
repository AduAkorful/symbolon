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
import type { IntentAnswer, IntentContext, IntentHandler } from "./types";

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
};

export const QUICK_QUESTIONS = [
  { label: "What are we paying this week?", intent: "payments_due", params: { days: 7 } },
  { label: "Why are any invoices held?", intent: "held_invoices", params: {} },
  { label: "What is our cash runway and position?", intent: "cash_position", params: {} },
  { label: "What is the Steward's status?", intent: "steward_status", params: {} },
  { label: "How much has Early Pay saved?", intent: "early_pay_savings", params: {} },
  { label: "What payments were settled recently?", intent: "recent_payments", params: { days: 30 } },
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
): Promise<IntentAnswer> {
  const handler = getIntentHandler(name);
  if (!handler) {
    const available = Object.keys(INTENT_HANDLERS).map((k) => k.replace(/_/g, " ")).join(", ");
    return {
      text: `I cannot answer that question yet. I can answer questions about: ${available}. Try one of the suggestions below.`,
      links: [],
      source: "From: Steward intent router",
      intent: "unsupported",
    };
  }
  return handler.execute(ctx, params);
}
