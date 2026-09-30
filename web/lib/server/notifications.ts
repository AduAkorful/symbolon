import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications, type Database } from "@symbolon/db";
import { describeNotification, type NotificationViewItem } from "./notification-text";

export interface FormattedNotification extends NotificationViewItem {
  id: string;
  kind: string;
  subject: string | null;
  readAt: string | null;
  createdAt: string;
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

  const items: FormattedNotification[] = rows.map((r) => {
    const desc = describeNotification({
      kind: r.kind,
      subject: r.subject,
      body: (r.body as Record<string, unknown>) ?? {},
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
