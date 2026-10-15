import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { byPhrase } from "@symbolon/core";
import { decisions, userAvatars, type Database } from "@symbolon/db";
import { avatarUrl } from "../avatar-url";
import { byFor } from "./actor-by";

/**
 * Who at the business declined this invoice, as the vendor may see them (plan 05zt): the latest decline's actor, shown the way
 * the vendor's bell shows it. Falls back to the payer's name alone when the actor isn't known.
 */
export async function declinedBy(db: Database, fingerprint: string, payerName: string): Promise<{ phrase: string; avatar?: string }> {
  const [row] = await db
    .select({ businessId: decisions.businessId, record: decisions.record })
    .from(decisions)
    .where(and(eq(decisions.kind, "invoice_declined"), eq(decisions.subject, fingerprint)))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  const actor = (row?.record as { inputs?: { actor?: unknown } } | undefined)?.inputs?.actor;
  if (!row || typeof actor !== "string") return { phrase: payerName };
  const by = await byFor(db, row.businessId, actor);
  const phrase = byPhrase({ ...by, businessName: payerName }, payerName);
  if (!by.byUserId) return { phrase };
  const [a] = await db.select({ updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, by.byUserId)).limit(1);
  const avatar = a ? avatarUrl(by.byUserId, a.updatedAt.getTime()) : undefined;
  return { phrase, ...(avatar ? { avatar } : {}) };
}
