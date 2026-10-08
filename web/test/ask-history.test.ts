import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import type { IntentDescriptor } from "@symbolon/steward";
import { buildHistory, HISTORY_TURNS } from "@/lib/ask-history";
import { sanitizeConversation, sanitizeHistory } from "@/lib/server/intents/history";

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

describe("buildHistory (plan 05y B1)", () => {
  it("builds turns from completed answers with the reply the person saw, skipping errors and unanswered turns (plan 05ze)", () => {
    const log = [
      { q: "What are we paying this week?", a: { text: "t", links: [], source: "s", intent: "payments_due", params: { days: 7 } } },
      { q: "gibberish", a: { text: "t", links: [], source: "s", intent: "unsupported", params: {} } },
      { q: "broken", error: "Couldn't reach the Steward." },
      { q: "pending" },
      { q: "Why are any invoices held?", a: { text: "t", links: [], source: "s", intent: "held_invoices", params: {} } },
    ];
    expect(buildHistory(log)).toEqual([
      { ...turn("What are we paying this week?", "payments_due", { days: 7 }), reply: "t" },
      { ...turn("gibberish", "unsupported"), reply: "t" },
      { ...turn("Why are any invoices held?", "held_invoices"), reply: "t" },
    ]);
  });

  it("keeps only the newest N turns", () => {
    const log = Array.from({ length: HISTORY_TURNS + 4 }, (_, i) => ({ q: `q${i}`, a: { text: "t", links: [], source: "s", intent: "held_invoices", params: {} } }));
    const out = buildHistory(log);
    expect(out).toHaveLength(HISTORY_TURNS);
    expect(out[0]?.question).toBe("q4");
  });
});

describe("sanitizeConversation (plan 05ze)", () => {
  it("keeps replies and conversation turns, and drops what doesn't fit", () => {
    const out = sanitizeConversation(
      [
        { ...turn("hi", "conversation"), reply: "Hello." },
        { ...turn("what is due", "payments_due", { days: 7 }), reply: "Nothing is due." },
        turn("bad", "held_invoices", { days: 3 }),
        { ...turn("gibberish", "unsupported"), reply: "x".repeat(901) },
        turn("wire", "wire_money"),
      ],
      intents,
    );
    expect(out).toEqual([
      { question: "hi", intent: "conversation", params: {}, reply: "Hello." },
      { question: "what is due", intent: "payments_due", params: { days: 7 }, reply: "Nothing is due." },
      { question: "gibberish", intent: "conversation", params: {} },
    ]);
  });

  it("drops the whole history when a turn is malformed or holds control characters", () => {
    expect(sanitizeConversation([turn("ok", "conversation"), { question: 3 }], intents)).toEqual([]);
    expect(sanitizeConversation([{ ...turn("ok", "conversation"), reply: "bad\u202etext" }], intents)).toEqual([{ question: "ok", intent: "conversation", params: {} }]);
    expect(sanitizeConversation("nope", intents)).toEqual([]);
  });
});
