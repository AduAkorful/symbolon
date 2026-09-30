import "server-only";
import { eq } from "drizzle-orm";
import { businesses, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { getDb } from "./db";
import { AuthError } from "./errors";
import { executeIntent, listIntentDescriptors } from "./intents/registry";
import type { IntentAnswer, IntentContext } from "./intents/types";
import { rateLimit } from "./rate";
import { getStewardModel } from "./steward-model";

export interface AskInput {
  businessId: string;
  userId: string;
  question?: string;
  intent?: string;
  params?: Record<string, unknown>;
  modelOverride?: import("@symbolon/steward").StewardModel;
  db?: Database;
}

/**
 * Handles a member's question to the Steward (plan 05u Part C).
 * Read-only by construction; never moves money or modifies state.
 */
export async function askSteward(input: AskInput): Promise<IntentAnswer> {
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

  const model = input.modelOverride ?? getStewardModel();
  if (!model || !model.route) {
    return {
      text: "Typing questions needs an Anthropic key; the questions above work now.",
      links: [],
      source: "From: Steward intent router (no API key configured)",
      intent: "unsupported",
    };
  }

  const descriptors = listIntentDescriptors();
  const routeRes = await model.route(question, descriptors);

  if ("params" in routeRes) {
    return executeIntent(ctx, routeRes.intent, routeRes.params);
  }

  const available = descriptors.map((d) => d.name.replace(/_/g, " ")).join(", ");
  return {
    text: `I couldn't match that to an available question. I can answer questions about: ${available}. Try one of the quick suggestions below.`,
    links: [],
    source: "From: Steward intent router",
    intent: "unsupported",
  };
}
