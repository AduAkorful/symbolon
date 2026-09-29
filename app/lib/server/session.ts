import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { sessions, users, type Database } from "@symbolon/db";

// Plan 05g, S1–S2. The cookie carries a random token; the database keeps only its SHA-256, so a copied row can't be replayed.
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is only rewritten when it is this stale, so reading a session isn't a database write every time */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export type SessionMethod = "circle" | "wallet" | "dev";
export type SessionUser = typeof users.$inferSelect;

const TOKEN_LENGTH = 43; // 32 random bytes, base64url without padding

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Database, userId: string, method: SessionMethod, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), method, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

/** The signed-in user for a cookie token, or null: unknown, malformed, expired, idle too long, or revoked all look the same */
export async function readSession(db: Database, token: string | undefined, now = new Date()): Promise<{ sessionId: string; method: SessionMethod; user: SessionUser } | null> {
  if (!token || token.length !== TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  const { session, user } = row;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= now.getTime()) return null;
  if (session.lastSeenAt.getTime() + SESSION_IDLE_MS <= now.getTime()) return null;
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
  }
  return { sessionId: session.id, method: session.method, user };
}

export async function revokeSession(db: Database, sessionId: string, now = new Date()): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** "Sign out everywhere": every live session of this user, including the current one */
export async function revokeAllSessions(db: Database, userId: string, now = new Date()): Promise<void> {
  await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
