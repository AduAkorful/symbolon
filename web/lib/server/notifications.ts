import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { decodeSealedInvoice } from "@symbolon/seal";
import { notifications, seals, userAvatars, vendorRequests, type Database } from "@symbolon/db";
import { avatarUrl } from "../avatar-url";
import { describeNotification, type NotificationViewItem } from "./notification-text";

export interface FormattedNotification extends NotificationViewItem {
  id: string;
  kind: string;
  subject: string | null;
  readAt: string | null;
  createdAt: string;
  /** The acting person's picture, when their name is shown and they have one (plan 05zt) */
  byAvatar?: string;
}

/**
 * Returns the count of unread notifications for a user (plan 05u N5).
 */
export async function getUnreadNotificationCount(db: Database, userId: string): Promise<number> {
  const [res] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return res?.count ?? 0;
}

/**
 * Loads notifications for a user with pagination and honest counts (plan 05u N5, N6).
 * Users only see their own notifications.
 */
export async function listNotifications(
  db: Database,
  userId: string,
  opts?: { limit?: number; offset?: number },
): Promise<{ items: FormattedNotification[]; total: number; unreadCount: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  const offset = Math.max(opts?.offset ?? 0, 0);

  const [countRes, unreadRes, rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.userId, userId)),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  const extra = await requestFacts(db, rows.filter((r) => r.kind.startsWith("vendor_") && r.subject).map((r) => r.subject as string));

  const byIds = [...new Set(rows.map((r) => (r.body as Record<string, unknown> | null)?.byUserId).filter((v): v is string => typeof v === "string"))];
  const avatars = new Map<string, number>();
  if (byIds.length > 0) {
    for (const a of await db.select({ userId: userAvatars.userId, updatedAt: userAvatars.updatedAt }).from(userAvatars).where(inArray(userAvatars.userId, byIds))) {
      avatars.set(a.userId, a.updatedAt.getTime());
    }
  }

  const items: FormattedNotification[] = rows.map((r) => {
    const desc = describeNotification({
      kind: r.kind,
      subject: r.subject,
      body: { ...((r.body as Record<string, unknown>) ?? {}), ...(r.subject ? extra.get(r.subject) ?? {} : {}) },
      createdAt: r.createdAt,
    });
    return {
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      title: desc.title,
      body: desc.body,
      ...(desc.href ? { href: desc.href } : {}),
      ...(() => {
        const id = (r.body as Record<string, unknown> | null)?.byUserId;
        const url = typeof id === "string" ? avatarUrl(id, avatars.get(id) ?? null) : undefined;
        return url ? { byAvatar: url } : {};
      })(),
    };
  });

  return {
    items,
    total: countRes[0]?.total ?? 0,
    unreadCount: unreadRes[0]?.unread ?? 0,
  };
}

/**
 * Updates notification read status. Scoped strictly to the authenticated userId.
 * Ids not owned by the user are ignored without error (plan 05u N5).
 */
export async function markNotifications(
  db: Database,
  userId: string,
  action: "read" | "unread" | "read-all",
  ids?: string[],
): Promise<void> {
  const now = new Date();

  if (action === "read-all") {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return;
  }

  if (!ids || ids.length === 0) return;

  if (action === "read") {
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
  } else if (action === "unread") {
    await db
      .update(notifications)
      .set({ readAt: null })
      .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vendor-request notices written before they carried a name read "A vendor asked to cancel an invoice". What they are about is on
 * the request itself (its Seal and, for a cancellation or credit note, the sealed invoice), so it is read here, and stored notices
 * need no rewrite.
 */
async function requestFacts(db: Database, subjects: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(subjects.filter((s) => UUID.test(s)))];
  if (!ids.length) return out;
  const reqs = await db.select({ id: vendorRequests.id, seal: vendorRequests.seal, message: vendorRequests.message, fingerprint: vendorRequests.fingerprint }).from(vendorRequests).where(inArray(vendorRequests.id, ids));
  if (!reqs.length) return out;
  const names = await db.select({ address: seals.address, displayName: seals.displayName, handle: seals.handle }).from(seals).where(inArray(seals.address, [...new Set(reqs.map((r) => r.seal.toLowerCase()))]));
  const nameOf = new Map(names.map((n) => [n.address.toLowerCase(), n.displayName || n.handle || undefined]));
  for (const r of reqs) {
    const facts: Record<string, unknown> = {};
    const name = nameOf.get(r.seal.toLowerCase());
    if (name) facts.vendorName = name;
    const envelope = (r.message as { envelope?: unknown } | null)?.envelope;
    if (typeof envelope === "string") {
      try {
        facts.invoiceNumber = decodeSealedInvoice(envelope).document.invoiceNumber;
      } catch {
        /* an envelope that doesn't decode just leaves the invoice unnamed */
      }
    }
    if (r.fingerprint) facts.fingerprint = r.fingerprint;
    out.set(r.id, facts);
  }
  return out;
}
