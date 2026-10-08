// Plan 05y: the conversation Ask remembers. Lives in the browser tab and travels with each typed question; the server stores nothing.

/** How many earlier turns are sent. Chosen from the conversation test (plan 05y B10), not guessed. */
export const HISTORY_TURNS = 6;

export interface HistoryTurn {
  question: string;
  intent: string;
  params: Record<string, unknown>;
  /** What the person was shown (plan 05ze): context for wording a follow-up, never a source of facts */
  reply?: string;
}

interface LoggedTurn {
  q: string;
  a?: { text?: string; intent: string; params?: Record<string, unknown> };
  error?: string;
}

const MAX_REPLY = 900;

/** The earlier turns that were answered: the person's words, what they resolved to, and the reply they saw (plan 05ze) */
export function buildHistory(log: LoggedTurn[]): HistoryTurn[] {
  return log
    .filter((m) => m.a)
    .map((m) => ({ question: m.q, intent: m.a!.intent, params: m.a!.params ?? {}, ...(m.a!.text ? { reply: m.a!.text.slice(0, MAX_REPLY) } : {}) }))
    .slice(-HISTORY_TURNS);
}
