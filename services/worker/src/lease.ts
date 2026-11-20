import { sql } from "drizzle-orm";

import { syncCursors, type Database } from "@symbolon/db";

/** Longer than one indexer tick, so a tick killed before it let go never blocks the next one for long. */
const LEASE_SECONDS = 180;

const leaseKey = (chainId: number) => `lease:cron-sync:${chainId}`;

/** Takes the run lease, or returns false when another run holds it. */
export async function takeSyncLease(db: Database, chainId: number): Promise<boolean> {
  const rows = await db
    .insert(syncCursors)
    .values({ key: leaseKey(chainId), chainId, block: 0n })
    .onConflictDoUpdate({
      target: syncCursors.key,
      set: { updatedAt: sql`now()` },
      setWhere: sql`${syncCursors.updatedAt} < now() - make_interval(secs => ${LEASE_SECONDS})`,
    })
    .returning({ key: syncCursors.key });
  return rows.length > 0;
}

export async function releaseSyncLease(db: Database, chainId: number): Promise<void> {
  await db.update(syncCursors).set({ updatedAt: sql`to_timestamp(0)` }).where(sql`${syncCursors.key} = ${leaseKey(chainId)}`);
}
