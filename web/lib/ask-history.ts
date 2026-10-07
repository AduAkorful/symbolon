// Plan 05y: the conversation Ask remembers. Lives in the browser tab and travels with each typed question; the server stores nothing.

/** How many earlier turns are sent. Chosen from the conversation test (plan 05y B10), not guessed. */
export const HISTORY_TURNS = 6;

export interface HistoryTurn {
  question: string;
  intent: string;
  params: Record<string, unknown>;
}

interface LoggedTurn {
  q: string;
  a?: { intent: string; params?: Record<string, unknown> };
  error?: string;
}

/** The earlier turns that resolved to a real question: the person's words, the intent and its parameters, never the answer text */
export function buildHistory(log: LoggedTurn[]): HistoryTurn[] {
  return log
    .filter((m) => m.a && m.a.intent !== "unsupported")
    .map((m) => ({ question: m.q, intent: m.a!.intent, params: m.a!.params ?? {} }))
    .slice(-HISTORY_TURNS);
}
