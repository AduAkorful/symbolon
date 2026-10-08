import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { askMessages, type Database } from "@symbolon/db";
import type { RouteTurn } from "@symbolon/steward";
import { HISTORY_TURNS } from "../ask-history";
import { CONVERSATION_INTENT } from "./intents/history";
import type { AskedAnswer } from "./intents/types";

// Plan 05zf. A person's thread with the Steward, kept per person and business. Every query is scoped to both in the statement
// itself, so no other member (the owner included) ever reads another person's questions.

/** How many messages the page shows */
export const THREAD_SHOWN = 50;
/** How long a message is kept */
export const THREAD_KEPT_DAYS = 30;

export interface StoredMessage {
  id: string;
  question: string;
  answer: AskedAnswer;
  createdAt: string;
}

const own = (businessId: string, userId: string) => and(eq(askMessages.businessId, businessId), eq(askMessages.userId, userId));
/** The person's current thread: messages not yet moved aside by "New conversation" */
const current = (businessId: string, userId: string) => and(own(businessId, userId), isNull(askMessages.conversationId));

/** Keeps an exchange. A failure is returned, never thrown: the answer was already given and must still be shown. */
export async function saveExchange(db: Database, args: { businessId: string; userId: string; question: string; answer: AskedAnswer }): Promise<boolean> {
  try {
    const { answer } = args;
    await db.insert(askMessages).values({
      businessId: args.businessId,
      userId: args.userId,
      question: args.question,
      reply: answer.text,
      intent: answer.intent,
      params: answer.params,
      facts: answer.facts ?? null,
      source: answer.source,
      links: answer.links,
    });
    return true;
  } catch (e) {
    console.error("ask: the exchange could not be saved", e);
    return false;
  }
}

/** The person's last messages for this business, oldest first */
export async function loadThread(db: Database, businessId: string, userId: string, limit: number = THREAD_SHOWN): Promise<StoredMessage[]> {
  const rows = await db.select().from(askMessages).where(current(businessId, userId)).orderBy(desc(askMessages.createdAt), desc(askMessages.id)).limit(limit);
  return rows.reverse().map(toStored);
}

function toStored(r: typeof askMessages.$inferSelect): StoredMessage {
  return {
    id: r.id,
    question: r.question,
    createdAt: r.createdAt.toISOString(),
    answer: { text: r.reply, links: r.links, source: r.source, intent: r.intent, params: r.params, ...(r.facts ? { facts: r.facts } : {}) },
  };
}

/** What the model is told of the conversation: the stored last turns, never anything a browser sent */
export async function recentTurns(db: Database, businessId: string, userId: string, max: number = HISTORY_TURNS): Promise<RouteTurn[]> {
  const rows = await db.select().from(askMessages).where(current(businessId, userId)).orderBy(desc(askMessages.createdAt), desc(askMessages.id)).limit(max);
  return rows.reverse().map((r) => ({
    question: r.question,
    intent: r.intent === "unsupported" ? CONVERSATION_INTENT : r.intent,
    params: r.intent === "unsupported" ? {} : r.params,
    reply: r.reply,
  }));
}

export interface EarlierConversation {
  id: string;
  /** The first thing the person asked in it */
  title: string;
  messages: number;
  startedAt: string;
  lastAt: string;
}

/** The most earlier conversations the list shows */
export const EARLIER_SHOWN = 20;

/** "New conversation": moves the current thread aside as one earlier conversation. Returns its id, or null when there was nothing to move. */
export async function archiveThread(db: Database, businessId: string, userId: string): Promise<string | null> {
  const id = randomUUID();
  const moved = await db.update(askMessages).set({ conversationId: id }).where(current(businessId, userId)).returning({ id: askMessages.id });
  return moved.length > 0 ? id : null;
}

/** The person's earlier conversations for this business, newest first */
export async function listEarlier(db: Database, businessId: string, userId: string, limit: number = EARLIER_SHOWN): Promise<EarlierConversation[]> {
  const rows = await db
    .select({ conversationId: askMessages.conversationId, question: askMessages.question, createdAt: askMessages.createdAt })
    .from(askMessages)
    .where(and(own(businessId, userId), isNotNull(askMessages.conversationId)))
    .orderBy(asc(askMessages.createdAt), asc(askMessages.id));
  const byId = new Map<string, EarlierConversation>();
  for (const r of rows) {
    const key = r.conversationId!;
    const at = r.createdAt.toISOString();
    const found = byId.get(key);
    if (found) {
      found.messages++;
      found.lastAt = at;
    } else byId.set(key, { id: key, title: r.question, messages: 1, startedAt: at, lastAt: at });
  }
  return [...byId.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, limit);
}

/** One earlier conversation's messages, oldest first; empty when it isn't this person's */
export async function loadEarlier(db: Database, businessId: string, userId: string, conversationId: string): Promise<StoredMessage[]> {
  const rows = await db.select().from(askMessages).where(and(own(businessId, userId), eq(askMessages.conversationId, conversationId))).orderBy(asc(askMessages.createdAt), asc(askMessages.id));
  return rows.map(toStored);
}

/** Deletes one earlier conversation, the author's only. Returns how many messages were removed. */
export async function deleteEarlier(db: Database, businessId: string, userId: string, conversationId: string): Promise<number> {
  const gone = await db.delete(askMessages).where(and(own(businessId, userId), eq(askMessages.conversationId, conversationId))).returning({ id: askMessages.id });
  return gone.length;
}

/** Removes messages past their keeping time, for everyone; run by the sync cron */
export async function deleteExpiredMessages(db: Database, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - THREAD_KEPT_DAYS * 86_400_000);
  const gone = await db.delete(askMessages).where(lt(askMessages.createdAt, cutoff)).returning({ id: askMessages.id });
  return gone.length;
}

