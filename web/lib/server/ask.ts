import "server-only";
import { eq } from "drizzle-orm";
import { businesses, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { getDb } from "./db";
import { AuthError } from "./errors";
import { executeIntent, listIntentDescriptors } from "./intents/registry";
import { checkReply } from "./ask-check";
import { CONVERSATION_INTENT, sanitizeConversation, sanitizeHistory } from "./intents/history";
import type { AskedAnswer, IntentContext } from "./intents/types";
import type { IntentDescriptor, PlanResult, RouteTurn, StewardModel } from "@symbolon/steward";
import { rateLimit } from "./rate";
import { getStewardModel } from "./steward-model";

export interface AskInput {
  businessId: string;
  userId: string;
  question?: string;
  intent?: string;
  params?: Record<string, unknown>;
  /** The earlier turns of this conversation, as the browser sent them; checked before use (plan 05y B2) */
  history?: unknown;
  db?: Database;
}

/**
 * Handles a member's question to the Steward (plan 05u Part C).
 * Read-only by construction; never moves money or modifies state.
 */
export async function askSteward(input: AskInput): Promise<AskedAnswer> {
  const db = input.db ?? (await getDb());
  await requireMember(db, input.userId, input.businessId);

  // Rate limiting (in-memory courtesy limit: 30 requests per minute per user)
  rateLimit(`ask:${input.userId}`, 30, 60_000, undefined, "Too many questions. Please slow down and try again in a minute.");

  const [biz] = await db
    .select({
      id: businesses.id,
      vault: businesses.vault,
      chainId: businesses.chainId,
    })
    .from(businesses)
    .where(eq(businesses.id, input.businessId))
    .limit(1);

  if (!biz) throw new AuthError(404, "Business not found.");

  const config = getConfig();
  const client = getClient();
  const ctx: IntentContext = {
    db,
    businessId: input.businessId,
    client,
    deployment: config.deployment,
    vaultAddress: biz.vault ? (biz.vault as `0x${string}`) : undefined,
    userId: input.userId,
  };

  // Direct intent execution (e.g. quick-question buttons)
  if (input.intent) {
    return executeIntent(ctx, input.intent, input.params ?? {});
  }

  const question = input.question?.trim();
  if (!question) {
    throw new AuthError(400, "Please provide a question or select an intent.");
  }

  const model = getStewardModel();
  if (!model || !model.route) {
    return {
      text: "Typing questions isn't available right now; the quick questions work.",
      links: [],
      source: "From: Steward intent router (no model configured)",
      intent: "unsupported",
      params: {},
    };
  }

  const descriptors = listIntentDescriptors();
  if (model.plan && model.phrase) return converse({ ctx, model: model as ConversingModel, question, history: sanitizeConversation(input.history, descriptors), descriptors });

  const routeRes = await model.route(question, descriptors, sanitizeHistory(input.history, descriptors));

  if ("params" in routeRes) {
    return executeIntent(ctx, routeRes.intent, routeRes.params);
  }

  if (routeRes.reason === "needs_detail") {
    return {
      text: "Which one do you mean? Try naming the vendor or the invoice.",
      links: [],
      source: "From: Steward intent router",
      intent: "unsupported",
      params: {},
    };
  }

  const available = descriptors.map((d) => d.name.replace(/_/g, " ")).join(", ");
  return {
    text: `I couldn't match that to an available question. I can answer questions about: ${available}. Try one of the quick suggestions below.`,
    links: [],
    source: "From: Steward intent router",
    intent: "unsupported",
    params: {},
  };
}

type ConversingModel = StewardModel & Required<Pick<StewardModel, "plan" | "phrase">>;

const stripFrom = (source: string) => source.replace(/^From:\s*/i, "");
const unique = <T,>(items: T[]) => [...new Set(items)];

/**
 * A typed message as a conversation turn (plan 05ze): plan the lookups, run them, let the model word a reply from what they
 * returned, and show that reply only if it passes `checkReply`. Anything else falls back to the lookups' own sentences.
 */
async function converse(args: { ctx: IntentContext; model: ConversingModel; question: string; history: RouteTurn[]; descriptors: IntentDescriptor[] }): Promise<AskedAnswer> {
  const { ctx, model, question, history, descriptors } = args;
  const modelDown: AskedAnswer = {
    text: "I couldn't reach the language model just now, so I can't chat. The quick questions beside this still work.",
    links: [],
    source: "From: Steward (model unavailable)",
    intent: CONVERSATION_INTENT,
    params: {},
  };

  let plan: PlanResult;
  try {
    plan = await model.plan(question, descriptors, history);
  } catch (e) {
    console.error("ask: the model could not plan", e);
    return modelDown;
  }

  if (plan.reads.length === 0 && plan.clarify && checkReply(plan.clarify, { facts: [], question }).ok) {
    return { text: plan.clarify, links: [], source: "From: your question", intent: CONVERSATION_INTENT, params: {} };
  }

  const results = await Promise.all(
    plan.reads.map((r) =>
      executeIntent(ctx, r.intent, r.params).catch((e): AskedAnswer => {
        console.error("ask: a lookup failed", r.intent, e);
        return { text: "I couldn't read that just now.", links: [], source: "From: a failed read", intent: r.intent, params: {} };
      }),
    ),
  );
  const facts = results.map((r) => ({ text: r.text, source: r.source }));
  const links = unique(results.flatMap((r) => r.links.map(([label, href]) => `${label}\u0000${href}`))).map((k) => k.split("\u0000") as [string, string]);

  let reply: string | null = null;
  try {
    reply = await model.phrase({ question, history, facts: results.map((r) => ({ topic: r.intent, text: r.text, source: r.source })), topics: descriptors });
  } catch (e) {
    console.error("ask: the model could not write a reply", e);
  }
  if (reply !== null) {
    const verdict = checkReply(reply, { facts: facts.flatMap((f) => [f.text, f.source]), question });
    if (verdict.ok) {
      return {
        text: reply.trim(),
        links,
        source: results.length === 0 ? "From: the conversation (nothing was looked up)" : `From: ${unique(results.map((r) => stripFrom(r.source))).join("; ")}`,
        intent: results[0]?.intent ?? CONVERSATION_INTENT,
        params: results.length === 1 ? results[0]!.params : {},
        ...(facts.length > 0 ? { facts } : {}),
      };
    }
    console.info("ask: a reply was replaced by the lookups' own text", { reason: verdict.reason });
  }

  if (results.length === 1) return results[0]!;
  if (results.length > 1) {
    return { text: results.map((r) => r.text).join("\n\n"), links, source: `From: ${unique(results.map((r) => stripFrom(r.source))).join("; ")}`, intent: results[0]!.intent, params: {} };
  }
  const topics = descriptors.map((d) => d.name.replace(/_/g, " ")).join(", ");
  return {
    text: `I can look up: ${topics}. I can't move money, approve, pause or change settings from here; those are done on their own pages. What would you like to know?`,
    links: [],
    source: "From: the conversation (nothing was looked up)",
    intent: CONVERSATION_INTENT,
    params: {},
  };
}
