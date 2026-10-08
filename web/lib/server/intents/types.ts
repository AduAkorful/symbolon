import "server-only";
import type { Address, PublicClient } from "viem";
import type { Deployment } from "@symbolon/chain";
import type { Database } from "@symbolon/db";
import type { IntentDescriptor } from "@symbolon/steward";

export interface IntentContext {
  db: Database;
  businessId: string;
  client: PublicClient;
  deployment: Deployment;
  vaultAddress?: Address;
  now?: Date;
  userId?: string;
}

export interface IntentAnswer {
  text: string;
  links: [string, string][];
  source: string;
  intent: string;
}

/** What Ask returns: the answer plus the parameters it ran with (checked against the intent's declaration), so the next question can refer back (plan 05y B5) */
export type AskedAnswer = IntentAnswer & {
  params: Record<string, unknown>;
  /** A conversational reply (plan 05ze): what the lookups behind it said, shown under "Show the numbers" */
  facts?: { text: string; source: string }[];
};

export interface IntentHandler {
  descriptor: IntentDescriptor;
  execute(ctx: IntentContext, params: Record<string, unknown>): Promise<IntentAnswer>;
}
