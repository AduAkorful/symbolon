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

export interface IntentHandler {
  descriptor: IntentDescriptor;
  execute(ctx: IntentContext, params: Record<string, unknown>): Promise<IntentAnswer>;
}
