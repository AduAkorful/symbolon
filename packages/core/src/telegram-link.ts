import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { telegramLinkCodes, telegramLinks, type Database } from "@symbolon/db";

/** Telegram linking and the bot's two commands (plan 05zr 4.1, 4.2): the part with no network and no secrets, so it is testable here. */

const CODE_TTL_MS = 10 * 60_000;
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/** The webhook's secret header, compared in constant time */
export function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A fresh one-time code for this person (older ones are dropped); only its hash is stored */
export async function createLinkCode(db: Database, userId: string, now: Date = new Date()): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId));
  await db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now));
  await db.insert(telegramLinkCodes).values({ codeHash: hashCode(code), userId, expiresAt: new Date(now.getTime() + CODE_TTL_MS) });
  return code;
}

/** Binds the chat to the code's account. One chat per account and one account per chat; a code works once. */
export async function consumeLinkCode(db: Database, code: string, chatId: string, now: Date = new Date()): Promise<{ userId: string; replacedChatId: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const hash = hashCode(code);
  const [row] = await db
    .delete(telegramLinkCodes)
    .where(and(eq(telegramLinkCodes.codeHash, hash), gt(telegramLinkCodes.expiresAt, now)))
    .returning({ userId: telegramLinkCodes.userId });
  if (!row) return null;
  const [previous] = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, row.userId));
  await db.delete(telegramLinks).where(eq(telegramLinks.chatId, chatId));
  await db.delete(telegramLinks).where(eq(telegramLinks.userId, row.userId));
  await db.insert(telegramLinks).values({ userId: row.userId, chatId });
  return { userId: row.userId, replacedChatId: previous && previous.chatId !== chatId ? previous.chatId : null };
}

export async function unlinkChat(db: Database, by: { userId: string } | { chatId: string }): Promise<boolean> {
  const rows = await db
    .delete(telegramLinks)
    .where("userId" in by ? eq(telegramLinks.userId, by.userId) : eq(telegramLinks.chatId, by.chatId))
    .returning({ userId: telegramLinks.userId });
  return rows.length > 0;
}

export async function linkedChat(db: Database, userId: string): Promise<string | null> {
  const [row] = await db.select({ chatId: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, userId));
  return row?.chatId ?? null;
}

export interface TelegramUpdate {
  message?: { text?: string; chat?: { id?: number | string; type?: string } };
}

const CONNECTED_HELP = "This chat is already connected. You'll get the notices you chose in Profile. Send /stop to disconnect.";
const HELP = "This bot only sends your Symbolon notices. To connect it, open Profile in Symbolon and choose Connect Telegram. Send /stop to disconnect.";

/** What the bot says back (null: say nothing). Only /start <code> and /stop do anything; other text is never echoed. */
export async function handleUpdate(db: Database, update: TelegramUpdate): Promise<{ chatId: string; reply: string; also?: { chatId: string; reply: string } } | null> {
  const m = update.message;
  if (!m?.chat || m.chat.type !== "private" || m.chat.id === undefined) return null;
  const chatId = String(m.chat.id);
  const text = typeof m.text === "string" ? m.text.trim() : "";
  const [command, arg] = text.split(/\s+/, 2);
  if (command === "/start" && arg) {
    const linked = await consumeLinkCode(db, arg, chatId);
    if (!linked) return { chatId, reply: "That link has expired. Open Profile in Symbolon and try again." };
    return {
      chatId,
      reply: "Linked. You'll get the notices you chose in Profile. Send /stop to disconnect.",
      ...(linked.replacedChatId ? { also: { chatId: linked.replacedChatId, reply: "This chat was replaced by a newer one and won't get notices any more." } } : {}),
    };
  }
  if (command === "/stop") {
    const had = await unlinkChat(db, { chatId });
    return { chatId, reply: had ? "Disconnected. You won't get notices here any more." : "Nothing was connected." };
  }
  const [already] = await db.select({ userId: telegramLinks.userId }).from(telegramLinks).where(eq(telegramLinks.chatId, chatId)).limit(1);
  return { chatId, reply: already ? CONNECTED_HELP : HELP };
}
