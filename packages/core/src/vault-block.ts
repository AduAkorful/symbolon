import { and, eq, sql } from "drizzle-orm";
import type { PublicClient } from "viem";

import type { Deployment } from "@symbolon/chain";
import { businesses, chainEvents, type Database } from "@symbolon/db";

/**
 * The block a Vault's history starts at. The network mirror already holds every factory's VaultCreated. Asking the RPC
 * for that log from the deployment block used to stall the public endpoints. Until the mirror has the Vault, the
 * deployment block is a safe start and nothing is saved.
 */
export async function ensureVaultBlock(
  db: Database,
  _client: PublicClient,
  deployment: Deployment,
  businessId: string,
  vaultAddress: string,
): Promise<bigint> {
  const [b] = await db.select({ vaultBlock: businesses.vaultBlock }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (b?.vaultBlock !== null && b?.vaultBlock !== undefined) return b.vaultBlock;

  try {
    const [row] = await db
      .select({ block: chainEvents.blockNumber })
      .from(chainEvents)
      .where(and(eq(chainEvents.chainId, deployment.chainId), eq(chainEvents.eventName, "VaultCreated"), sql`lower(${chainEvents.args}->>'vault') = ${vaultAddress.toLowerCase()}`))
      .orderBy(chainEvents.blockNumber)
      .limit(1);
    if (row?.block) {
      await db.update(businesses).set({ vaultBlock: row.block }).where(eq(businesses.id, businessId));
      return row.block;
    }
  } catch (err) {
    console.error("ensureVaultBlock failed to backfill:", err instanceof Error ? err.message : err);
  }
  return BigInt(deployment.startBlock);
}
