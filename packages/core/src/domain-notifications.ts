import { and, eq, inArray, ne } from "drizzle-orm";
import { members, seals, type Database } from "@symbolon/db";
import { notifyMany, type NotifyInput } from "./notify.js";

type Writer = Pick<Database, "select" | "insert">;
type DomainNotice = Omit<NotifyInput, "userId"> & { dedupeKey: string };

/** Recipients are current members, never IDs supplied by a caller. */
export async function notifyBusiness(db: Writer, businessId: string, notice: DomainNotice,
  opts: { roles?: ("owner" | "approver")[]; excludeUserId?: string } = {}) {
  const recipients = await db.select({ userId: members.userId }).from(members).where(and(
    eq(members.businessId, businessId), inArray(members.role, opts.roles ?? ["owner", "approver"]),
    ...(opts.excludeUserId ? [ne(members.userId, opts.excludeUserId)] : []),
  ));
  return notifyMany(db, recipients.map(({ userId }) => ({ ...notice, userId })));
}

/** Only the user who owns the invoice's Seal receives vendor notices. */
export async function notifyVendor(db: Writer, seal: string, notice: DomainNotice) {
  const recipients = await db.select({ userId: seals.userId }).from(seals).where(eq(seals.address, seal.toLowerCase()));
  return notifyMany(db, recipients.map(({ userId }) => ({ ...notice, userId })));
}
