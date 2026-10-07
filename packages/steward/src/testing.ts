import type { DecisionRecord } from "./records.js";
import type { Extraction, IntentDescriptor, RouteResult, RouteTurn, StewardModel } from "./model.js";

// Test double only. It lives behind the "@symbolon/steward/testing" subpath so no app or package code reaches it through the main entry.

/** A scripted model for tests */
export class FakeStewardModel implements StewardModel {
  constructor(
    private readonly extraction?: Extraction,
    private readonly explanation = "Decision recorded.",
    private readonly routes: Record<string, RouteResult> = {},
  ) {}

  async extractInvoice(): Promise<Extraction> {
    if (!this.extraction) throw new Error("no scripted extraction");
    return this.extraction;
  }

  async explain(): Promise<string> {
    return this.explanation;
  }

  async route(question: string, intents: IntentDescriptor[], history?: RouteTurn[]): Promise<RouteResult> {
    if (this.routes[question]) return this.routes[question];
    // a question that starts "and" / "what about" repeats the last turn's intent (test double only)
    const last = history?.at(-1);
    if (last && /^(and|what about|how about)\b/i.test(question.trim())) {
      return { intent: last.intent, params: { ...last.params } };
    }
    const q = question.toLowerCase();
    for (const intent of intents) {
      const name = intent.name.replace(/_/g, " ");
      if (q.includes(name) || q.includes(intent.name)) {
        return { intent: intent.name, params: {} };
      }
    }
    if (q.includes("paying") || q.includes("due")) {
      const found = intents.find((i) => i.name === "payments_due");
      if (found) return { intent: "payments_due", params: { days: 7 } };
    }
    if (q.includes("recent") || q.includes("paid")) {
      const found = intents.find((i) => i.name === "recent_payments");
      if (found) return { intent: "recent_payments", params: { days: 30 } };
    }
    if (q.includes("held") || q.includes("hold")) {
      const found = intents.find((i) => i.name === "held_invoices");
      if (found) return { intent: "held_invoices", params: {} };
    }
    if (q.includes("approval")) {
      const found = intents.find((i) => i.name === "awaiting_approval");
      if (found) return { intent: "awaiting_approval", params: {} };
    }
    if (q.includes("cash") || q.includes("runway") || q.includes("position")) {
      const found = intents.find((i) => i.name === "cash_position");
      if (found) return { intent: "cash_position", params: {} };
    }
    if (q.includes("steward") || q.includes("status")) {
      const found = intents.find((i) => i.name === "steward_status");
      if (found) return { intent: "steward_status", params: {} };
    }
    if (q.includes("reserve")) {
      const found = intents.find((i) => i.name === "reserve_status");
      if (found) return { intent: "reserve_status", params: {} };
    }
    if (q.includes("early pay") || q.includes("savings")) {
      const found = intents.find((i) => i.name === "early_pay_savings");
      if (found) return { intent: "early_pay_savings", params: {} };
    }
    return { intent: "unsupported", reason: "No matching intent found." };
  }
}
