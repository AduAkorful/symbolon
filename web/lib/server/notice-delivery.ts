import "server-only";
import { after } from "next/server";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { cleanPrefs, kindEnabled, setNoticeListener, withinRateGuard } from "@symbolon/core";
import { notifications, pushSubscriptions, telegramLinks, users, type Database } from "@symbolon/db";
import { getConfig } from "./config";
import { getDb } from "./db";
import { describeNotification } from "./notification-text";
import { pushConfig, sendPush } from "./push";
import { sendTelegramMessage, telegramConfig, unlinkChat } from "./telegram";

/**
 * Mirrors new notices to the channels (Telegram, web push) a person connected and chose (plan 05zr). The bell row already exists; this only adds a copy.
 * Nothing here is awaited by a money path beyond the notice's own insert, and a failure only records `sent_via`.
 */
async function deliver(db: Database, ids: string[]): Promise<void> {
  const tg = telegramConfig();
  const push = pushConfig();
  if (!tg && !push) return;
  const origin = getConfig().appOrigin;
  const rows = await db.select().from(notifications).where(inArray(notifications.id, ids));
  const hourAgo = new Date(Date.now() - 3_600_000);
  for (const row of rows) {
    const [user] = await db.select({ prefs: users.noticePrefs }).from(users).where(eq(users.id, row.userId));
    const prefs = cleanPrefs(user?.prefs);
    const wantTelegram = tg !== null && kindEnabled(prefs, "telegram", row.kind);
    const wantPush = push !== null && kindEnabled(prefs, "push", row.kind);
    if (!wantTelegram && !wantPush) continue;
    const [link] = wantTelegram ? await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, row.userId)) : [];
    const devices = wantPush ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, row.userId)) : [];
    if (!link && devices.length === 0) continue;
    // one cap for every channel together: a person is never sent more than a few messages an hour
    const sent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, row.userId), isNotNull(notifications.sentVia), gte(notifications.createdAt, hourAgo)));
    if (!withinRateGuard(sent.length)) continue;
    const view = describeNotification({ kind: row.kind, subject: row.subject, body: row.body, createdAt: row.createdAt });
    const delivered: string[] = [];
    if (tg && link) {
      const text = [view.title, view.body, view.href ? `Open: ${origin}${view.href}` : ""].filter(Boolean).join("\n");
      const result = await sendTelegramMessage(tg, link.chatId, text);
      if (result.ok) delivered.push("telegram");
      else {
        if (result.blocked) await unlinkChat(db, { userId: row.userId });
        console.error("telegram notice not sent", row.id, result.blocked ? "chat unreachable, unlinked" : "send failed");
      }
    }
    if (push) {
      let okAny = false;
      for (const device of devices) {
        const result = await sendPush(push, device, { title: view.title, body: view.body, ...(view.href ? { href: view.href } : {}) });
        if (result === "sent") okAny = true;
        else if (result === "gone") await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
        else console.error("push notice not sent", row.id);
      }
      if (okAny) delivered.push("push");
    }
    if (delivered.length) await db.update(notifications).set({ sentVia: delivered.join("+") }).where(eq(notifications.id, row.id));
  }
}

let registered = false;
/** Called once when the server starts (instrumentation.ts) */
export function registerNoticeDelivery(): void {
  if (registered) return;
  registered = true;
  // A notice is often created inside a database transaction (a decline, a verification). Delivery has to read the committed row, so
  // it runs after the response is sent, never inline: inline it would read before the commit (Neon: no row, nothing sent;
  // PGlite: it waits on the very transaction that is waiting for it).
  setNoticeListener(async (ids) => {
    const run = async () => {
      try {
        await deliver(await getDb(), ids);
      } catch (e) {
        console.error("notice delivery failed", e instanceof Error ? e.message : "unknown");
      }
    };
    try {
      after(run);
    } catch {
      // not inside a request (a script or a scheduled job): a short delay lets the writer commit first
      setTimeout(() => void run(), 1000);
    }
  });
}
