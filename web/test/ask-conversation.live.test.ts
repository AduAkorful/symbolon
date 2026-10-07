// Plan 05y B10: how well does follow-up routing hold up with the real model? Calls OpenRouter for real (a few cents).
//   LIVE=1 OPENROUTER_API_KEY=… EVAL_OUT=/path/results.json pnpm --filter @symbolon/app exec vitest run test/ask-conversation.live.test.ts
// Each turn is scored: correct, asked (the router said it needs detail or couldn't route: a safe miss), or wrong (a confident
// mistake: forgot, picked the wrong earlier turn, or invented a parameter). Forgetting and inventing are the failures that matter.
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { OpenRouterStewardModel, type RouteResult } from "@symbolon/steward";
import { sanitizeHistory } from "@/lib/server/intents/history";
import { listIntentDescriptors } from "@/lib/server/intents/registry";

const key = process.env.OPENROUTER_API_KEY?.trim();
const live = Boolean(process.env.LIVE && key);

type Verdict = "correct" | "asked" | "wrong";
type Expect =
  | { intent: string; params?: Record<string, unknown> }
  | { ask: true }
  | { oneOf: Expect[] };
interface Turn { q: string; expect: Expect; note?: string }
interface Scenario { name: string; kind: "follow-up" | "memory" | "no-referent" | "resolution"; turns: Turn[] }

const FILLER: Turn[] = [
  { q: "What is our cash runway and position?", expect: { intent: "cash_position" } },
  { q: "Why are any invoices held?", expect: { intent: "held_invoices" } },
  { q: "Any Early Pay offers waiting?", expect: { intent: "open_offers" } },
  { q: "Are any changes waiting?", expect: { intent: "pending_changes" } },
  { q: "What is our payment policy?", expect: { intent: "policy_summary" } },
];

const scenarios: Scenario[] = [
  { name: "days follow-ups", kind: "follow-up", turns: [
    { q: "What are we paying this week?", expect: { intent: "payments_due", params: { days: 7 } } },
    { q: "and next month?", expect: { intent: "payments_due", params: { days: 30 } } },
    { q: "what about the next two weeks?", expect: { intent: "payments_due", params: { days: 14 } } },
  ] },
  { name: "switch topic, then follow up on the newest", kind: "follow-up", turns: [
    { q: "Any Early Pay offers waiting?", expect: { intent: "open_offers" } },
    { q: "How much is left in our budgets?", expect: { intent: "budget_remaining" } },
    { q: "and for Marketing?", expect: { intent: "budget_remaining", params: { budget: "Marketing" } } },
  ] },
  { name: "vendor carries over, then 'them'", kind: "follow-up", turns: [
    { q: "Tell me about Studio Ana", expect: { intent: "vendor_summary", params: { vendor: "Studio Ana" } } },
    { q: "and Forge Supply?", expect: { intent: "vendor_summary", params: { vendor: "Forge Supply" } } },
    { q: "any open orders for them?", expect: { intent: "open_orders", params: { vendor: "Forge Supply" } } },
  ] },
  { name: "override a number", kind: "follow-up", turns: [
    { q: "Show me payments due in 10 days", expect: { intent: "payments_due", params: { days: 10 } } },
    { q: "make it 3", expect: { intent: "payments_due", params: { days: 3 } } },
  ] },
  { name: "an unrelated question in between doesn't break the thread", kind: "follow-up", turns: [
    { q: "What are we paying this week?", expect: { intent: "payments_due", params: { days: 7 } } },
    { q: "what's the weather in Lisbon?", expect: { ask: true } },
    { q: "and next month?", expect: { intent: "payments_due", params: { days: 30 } } },
  ] },
  { name: "follow-up with no earlier question", kind: "no-referent", turns: [
    { q: "and what about that one?", expect: { ask: true } },
  ] },
  { name: "'why?' after a list, with nothing named", kind: "no-referent", turns: [
    { q: "Why are any invoices held?", expect: { intent: "held_invoices" } },
    { q: "why?", expect: { oneOf: [{ ask: true }, { intent: "held_invoices" }, { intent: "why_decision", params: {} }] } },
  ] },
  { name: "a name that isn't a topic", kind: "resolution", turns: [
    { q: "What are we paying this week?", expect: { intent: "payments_due", params: { days: 7 } } },
    { q: "and Forge Supply?", expect: { oneOf: [{ intent: "vendor_summary", params: { vendor: "Forge Supply" } }, { ask: true }] } },
  ] },
  { name: "remembers a vendor five turns back", kind: "memory", turns: [
    { q: "Tell me about Studio Ana", expect: { intent: "vendor_summary", params: { vendor: "Studio Ana" } } },
    ...FILLER,
    { q: "what about their screening?", expect: { oneOf: [{ intent: "screening_status", params: { vendor: "Studio Ana" } }, { ask: true }] }, note: "five turns after the vendor" },
  ] },
  { name: "two vendors, then 'the first one'", kind: "memory", turns: [
    { q: "Tell me about Studio Ana", expect: { intent: "vendor_summary", params: { vendor: "Studio Ana" } } },
    { q: "Tell me about Forge Supply", expect: { intent: "vendor_summary", params: { vendor: "Forge Supply" } } },
    { q: "what about the first one's orders?", expect: { oneOf: [{ intent: "open_orders", params: { vendor: "Studio Ana" } }, { ask: true }] } },
  ] },
];

function judge(result: RouteResult, expect: Expect): Verdict {
  if ("oneOf" in expect) {
    const vs = expect.oneOf.map((e) => judge(result, e));
    return vs.includes("correct") ? "correct" : vs.includes("asked") ? "asked" : "wrong";
  }
  const unsupported = result.intent === "unsupported";
  if ("ask" in expect) return unsupported ? "correct" : "wrong";
  if (unsupported) return "asked";
  if (result.intent !== expect.intent) return "wrong";
  const got = "params" in result ? result.params : {};
  const want = expect.params ?? {};
  for (const [k, v] of Object.entries(want)) {
    const g = got[k];
    if (typeof v === "string" ? String(g ?? "").toLowerCase() !== v.toLowerCase() : g !== v) return "wrong";
  }
  // a parameter nobody said is an invention
  if (Object.keys(got).some((k) => !(k in want))) return "wrong";
  return "correct";
}

describe.skipIf(!live)("follow-up routing against the real model", { timeout: 600_000 }, () => {
  const intents = listIntentDescriptors();
  const model = new OpenRouterStewardModel({ apiKey: key ?? "", model: process.env.OPENROUTER_MODEL ?? "openai/gpt-6-luna", zdr: true, log: () => {} });
  const WINDOWS = (process.env.EVAL_WINDOWS ?? "0,2,4,6,10").split(",").map(Number);
  const RUNS = Number(process.env.EVAL_RUNS ?? 2);

  async function routeWithRetry(q: string, history: Parameters<typeof model.route>[2]): Promise<RouteResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await model.route(q, intents, history);
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async function play(s: Scenario, window: number) {
    const done: { question: string; intent: string; params: Record<string, unknown> }[] = [];
    const out: { q: string; verdict: Verdict; got: RouteResult; note?: string }[] = [];
    for (const t of s.turns) {
      const history = window === 0 ? [] : sanitizeHistory(done, intents, window);
      const got = await routeWithRetry(t.q, history);
      out.push({ q: t.q, verdict: judge(got, t.expect), got, note: t.note });
      if (got.intent !== "unsupported" && "params" in got) done.push({ question: t.q, intent: got.intent, params: got.params });
    }
    return out;
  }

  it("scores every window", async () => {
    const table: Record<string, { correct: number; asked: number; wrong: number; byKind: Record<string, { correct: number; asked: number; wrong: number }> }> = {};
    const detail: unknown[] = [];
    // one window at a time (ten conversations in parallel), so the provider isn't flooded
    for (const w of WINDOWS) {
      await (async () => {
        const agg = { correct: 0, asked: 0, wrong: 0, byKind: {} as Record<string, { correct: number; asked: number; wrong: number }> };
        for (let r = 0; r < RUNS; r++) {
          const played = await Promise.all(scenarios.map((s) => play(s, w)));
          played.forEach((turns, i) => {
            const kind = (agg.byKind[scenarios[i]!.kind] ??= { correct: 0, asked: 0, wrong: 0 });
            for (const t of turns) {
              agg[t.verdict]++;
              kind[t.verdict]++;
              if (t.verdict === "wrong") detail.push({ window: w, scenario: scenarios[i]!.name, q: t.q, got: t.got });
            }
          });
        }
        table[String(w)] = agg;
      })();
    }
    if (process.env.EVAL_OUT) writeFileSync(process.env.EVAL_OUT, JSON.stringify({ table, wrong: detail }, null, 2));
    expect(Object.keys(table)).toHaveLength(WINDOWS.length);
  });
});
