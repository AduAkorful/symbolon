import { lt } from "drizzle-orm";

import { askMessages, type Database } from "@symbolon/db";

const THREAD_KEPT_DAYS = 30;

/** Removes Ask messages past their keeping time. The sync cron used to do this. */
export async function deleteExpiredMessages(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - THREAD_KEPT_DAYS * 86_400_000);
  const gone = await db.delete(askMessages).where(lt(askMessages.createdAt, cutoff)).returning({ id: askMessages.id });
  return gone.length;
}
