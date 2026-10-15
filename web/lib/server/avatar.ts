import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { checkAvatar } from "@symbolon/core";
import { invoices, members, payees, seals, userAvatars, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import { avatarUrl } from "../avatar-url";

// Plan 05zs. A profile picture is decoration: it is stored after validation, served only to people the person already
// shares a business or a payment relationship with, and never drawn beside a money action or a verification.

// a person can change their picture, just not many times a second: one change per 30 seconds
const MIN_SECONDS_BETWEEN_CHANGES = 30;

export async function saveAvatar(db: Database, userId: string, bytes: Uint8Array): Promise<{ updatedAt: Date }> {
  const checked = checkAvatar(bytes);
  if (!checked.ok) throw new AuthError(400, checked.reason);
  const [row] = await db.select({ updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1);
  if (row && Date.now() - row.updatedAt.getTime() < MIN_SECONDS_BETWEEN_CHANGES * 1000) {
    throw new AuthError(429, "You changed your picture a moment ago. Try again in half a minute.");
  }
  const updatedAt = new Date();
  const values = { contentType: checked.type, dataBase64: Buffer.from(bytes).toString("base64"), byteSize: bytes.length, updatedAt };
  await db.insert(userAvatars).values({ userId, ...values }).onConflictDoUpdate({ target: userAvatars.userId, set: values });
  return { updatedAt };
}

export async function removeAvatar(db: Database, userId: string): Promise<void> {
  await db.delete(userAvatars).where(eq(userAvatars.userId, userId));
}

/** When the person last set a picture (a cache-busting version), or null when they have none */
export async function avatarVersion(db: Database, userId: string): Promise<number | null> {
  const [row] = await db.select({ updatedAt: userAvatars.updatedAt }).from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1);
  return row ? row.updatedAt.getTime() : null;
}

/**
 * May `viewerId` see `targetId`'s picture? Themselves; someone in a business they are in; or the other side of a payment
 * relationship: a member of a business the target's Seal has an invoice or payee with, or the Seal's owner for a business
 * the target is a member of. Checked per request, so leaving a business ends it at once.
 */
export async function mayViewAvatar(db: Database, viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true;
  const businessesOf = async (userId: string) =>
    (await db.select({ id: members.businessId }).from(members).where(eq(members.userId, userId))).map((r) => r.id);
  const sealsOf = async (userId: string) => (await db.select({ a: seals.address }).from(seals).where(eq(seals.userId, userId))).map((r) => r.a);
  const [mine, theirs] = await Promise.all([businessesOf(viewerId), businessesOf(targetId)]);
  if (mine.some((b) => theirs.includes(b))) return true;
  // the other side of a payment relationship: the Seal has a payee or an invoice with a business the viewer is in, or the reverse
  const related = async (sealAddresses: string[], businessIds: string[]) => {
    if (sealAddresses.length === 0 || businessIds.length === 0) return false;
    const [p] = await db.select({ id: payees.businessId }).from(payees).where(and(inArray(payees.seal, sealAddresses), inArray(payees.businessId, businessIds))).limit(1);
    if (p) return true;
    const [i] = await db.select({ id: invoices.fingerprint }).from(invoices).where(and(inArray(invoices.seal, sealAddresses), inArray(invoices.businessId, businessIds))).limit(1);
    return Boolean(i);
  };
  const [targetSeals, viewerSeals] = await Promise.all([sealsOf(targetId), sealsOf(viewerId)]);
  return (await related(targetSeals, mine)) || (await related(viewerSeals, theirs));
}

export async function loadAvatar(db: Database, viewerId: string, targetId: string): Promise<{ type: string; bytes: Buffer; version: number } | null> {
  const [row] = await db.select().from(userAvatars).where(eq(userAvatars.userId, targetId)).limit(1);
  if (!row) return null;
  if (!(await mayViewAvatar(db, viewerId, targetId))) return null;
  return { type: row.contentType, bytes: Buffer.from(row.dataBase64, "base64"), version: row.updatedAt.getTime() };
}

export { avatarUrl } from "../avatar-url";
