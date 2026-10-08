import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { IntentDescriptor } from "@symbolon/steward";
import { HISTORY_TURNS } from "@/lib/ask-history";
import { sanitizeHistory } from "@/lib/server/intents/history";

const intents: IntentDescriptor[] = [
  { name: "payments_due", description: "", params: { days: { type: "number", description: "" } } },
  { name: "why_decision", description: "", params: { invoice: { type: "string", description: "" } } },
  { name: "held_invoices", description: "" },
];
const turn = (question: string, intent: string, params: Record<string, unknown> = {}) => ({ question, intent, params });

describe("sanitizeHistory (plan 05y B2)", () => {
  it("keeps good turns, oldest first, trimmed to the newest N", () => {
    const raw = Array.from({ length: HISTORY_TURNS + 3 }, (_, i) => turn(`q${i}`, "held_invoices"));
    const out = sanitizeHistory(raw, intents);
    expect(out).toHaveLength(HISTORY_TURNS);
    expect(out.at(-1)?.question).toBe(`q${HISTORY_TURNS + 2}`);
  });

  it("drops a turn with an unknown intent, or with a parameter the intent doesn't declare, or of the wrong type", () => {
    const out = sanitizeHistory(
      [turn("a", "wire_money"), turn("b", "held_invoices", { days: 3 }), turn("c", "payments_due", { days: "7" }), turn("d", "payments_due", { days: 7 })],
      intents,
    );
    expect(out).toEqual([turn("d", "payments_due", { days: 7 })]);
  });

  it("drops the whole history when any question holds a control or bidi character, or is too long", () => {
    expect(sanitizeHistory([turn("fine", "held_invoices"), turn("bad‮text", "held_invoices")], intents)).toEqual([]);
    expect(sanitizeHistory([turn("bad\u0007bell", "held_invoices")], intents)).toEqual([]);
    expect(sanitizeHistory([turn("x".repeat(301), "held_invoices")], intents)).toEqual([]);
  });

  it("treats anything that isn't a well-formed list as no history", () => {
    for (const bad of [undefined, null, "history", 7, {}, [null], [{}], [{ question: 1, intent: "held_invoices", params: {} }], [{ question: "q", intent: "held_invoices", params: [] }]]) {
      expect(sanitizeHistory(bad, intents)).toEqual([]);
    }
  });

  it("carries only the three fields, never an answer", () => {
    const out = sanitizeHistory([{ ...turn("q", "held_invoices"), answer: "SECRET", text: "x" }], intents);
    expect(out).toEqual([turn("q", "held_invoices")]);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });
});
