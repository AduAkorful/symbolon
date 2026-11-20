import { and, eq, isNull } from "drizzle-orm";
import type { PublicClient } from "viem";

import { chainEvents, type Database } from "@symbolon/db";

/** Fills missing block times on a Vault's stored events. One batch per call; the next tick continues. */
export async function backfillBlockTimes(db: Database, client: PublicClient, vaultAddress: string): Promise<void> {
  const unbacked = await db
    .select({ blockNumber: chainEvents.blockNumber })
    .from(chainEvents)
    .where(and(eq(chainEvents.address, vaultAddress.toLowerCase()), isNull(chainEvents.blockTime)))
    .limit(20);
  const distinct = [...new Set(unbacked.map((u) => u.blockNumber))];
  await Promise.all(distinct.map(async (bn) => {
    try {
      const block = await client.getBlock({ blockNumber: bn });
      const blockTime = new Date(Number(block.timestamp) * 1000);
      await db.update(chainEvents).set({ blockTime }).where(eq(chainEvents.blockNumber, bn));
    } catch {
      /* a transient RPC miss leaves the row for the next tick */
    }
  }));
}
