import "server-only";
import type { IntentDescriptor, RouteTurn } from "@symbolon/steward";
import { HISTORY_TURNS } from "../../ask-history";
import { UNSAFE_TEXT } from "../../text-safety";

const MAX_QUESTION = 300;

/**
 * The conversation a browser sent with a question, checked before the router sees it (plan 05y B2). Only turns that
 * resolve to a registered intent with parameters that intent declares, of the declared type, survive; the model gets the
 * person's own words, the intent and its parameters, and nothing else. A history that doesn't look right is dropped whole:
 * the question is then answered on its own, never refused.
 */
export function sanitizeHistory(raw: unknown, intents: IntentDescriptor[], max: number = HISTORY_TURNS): RouteTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteTurn[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const { question, intent, params } = item as Record<string, unknown>;
    if (typeof question !== "string" || typeof intent !== "string") return [];
    if (params === null || typeof params !== "object" || Array.isArray(params)) return [];
    const q = question.normalize("NFC").trim();
    if (q.length === 0 || q.length > MAX_QUESTION || UNSAFE_TEXT.test(q)) return [];

    const descriptor = intents.find((i) => i.name === intent);
    if (!descriptor) continue;
    const declared = descriptor.params ?? {};
    const entries = Object.entries(params as Record<string, unknown>);
    const fits = entries.every(([k, v]) => {
      const d = declared[k];
      if (!d) return false;
      return d.type === "number" ? typeof v === "number" && Number.isFinite(v) : d.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && v.length <= MAX_QUESTION && !UNSAFE_TEXT.test(v);
    });
    if (!fits) continue;
    out.push({ question: q, intent, params: Object.fromEntries(entries) });
  }
  return out.slice(-max);
}

const MAX_REPLY = 900;
/** Turns that were conversation, not a lookup: a greeting, a reaction, a question back */
export const CONVERSATION_INTENT = "conversation";

/**
 * The conversation a browser sent with a typed message, checked before the planner sees it (plan 05ze). Unlike
 * `sanitizeHistory`, replies travel too, because a follow-up ("why?") needs what the person was shown; they are context for
 * wording only and never widen what a reply may state. A turn survives only with the person's own words and either a registered
 * intent with parameters it declares, or the conversation marker. A history that doesn't look right is dropped whole.
 */
export function sanitizeConversation(raw: unknown, intents: IntentDescriptor[], max: number = HISTORY_TURNS): RouteTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: RouteTurn[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const { question, reply, intent, params } = item as Record<string, unknown>;
    if (typeof question !== "string" || typeof intent !== "string") return [];
    const q = question.normalize("NFC").trim();
    if (q.length === 0 || q.length > MAX_QUESTION || UNSAFE_TEXT.test(q)) return [];
    const r = typeof reply === "string" ? reply.normalize("NFC").trim() : "";
    const shown = r.length > 0 && r.length <= MAX_REPLY && !UNSAFE_TEXT.test(r) ? { reply: r } : {};

    if (intent === CONVERSATION_INTENT || intent === "unsupported") {
      out.push({ question: q, intent: CONVERSATION_INTENT, params: {}, ...shown });
      continue;
    }
    const descriptor = intents.find((i) => i.name === intent);
    if (!descriptor || params === null || typeof params !== "object" || Array.isArray(params)) continue;
    const declared = descriptor.params ?? {};
    const entries = Object.entries(params as Record<string, unknown>);
    const fits = entries.every(([k, v]) => {
      const d = declared[k];
      if (!d) return false;
      return d.type === "number" ? typeof v === "number" && Number.isFinite(v) : d.type === "boolean" ? typeof v === "boolean" : typeof v === "string" && v.length <= MAX_QUESTION && !UNSAFE_TEXT.test(v);
    });
    if (!fits) continue;
    out.push({ question: q, intent, params: Object.fromEntries(entries), ...shown });
  }
  return out.slice(-max);
}
