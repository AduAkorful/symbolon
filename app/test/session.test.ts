import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, sessions, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, createSession, readSession, revokeAllSessions, revokeSession } from "@/lib/server/session";
import { walletUser as upsertWalletUser } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const T0 = new Date("2026-09-29T10:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe("sessions", () => {
  it("signs a user in from the cookie token and keeps only its hash", async () => {
    const u = await upsertWalletUser(db, wallet(1));
    const { token } = await createSession(db, u.id, "privy", T0);
    const seen = await readSession(db, token, later(1000));
    expect(seen?.user.id).toBe(u.id);
    expect(seen?.method).toBe("privy");
    const rows = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([undefined, "", "short", "!".repeat(43), "A".repeat(43), "A".repeat(44)])("treats %j as signed out", async (t) => {
    expect(await readSession(db, t, T0)).toBeNull();
  });

  it("expires after the absolute lifetime, and after too long idle", async () => {
    const u = await upsertWalletUser(db, wallet(2));
    const { token } = await createSession(db, u.id, "privy", T0);
    expect(await readSession(db, token, later(SESSION_IDLE_MS - 1000))).not.toBeNull();
    // last seen was moved forward by that read? it only moves when stale; use a fresh session to test the idle limit cleanly
    const idle = await createSession(db, u.id, "privy", T0);
    expect(await readSession(db, idle.token, later(SESSION_IDLE_MS + 1000))).toBeNull();
    const old = await createSession(db, u.id, "privy", T0);
    // keep it active every few days, so only the absolute limit can end it
    for (let d = 3; d < 30; d += 3) expect(await readSession(db, old.token, later(d * 24 * 3600 * 1000))).not.toBeNull();
    expect(await readSession(db, old.token, later(SESSION_ABSOLUTE_MS + 1000))).toBeNull();
  });

  it("is signed out after a revoke, and a revoke touches only that session", async () => {
    const u = await upsertWalletUser(db, wallet(3));
    const a = await createSession(db, u.id, "privy", T0);
    const b = await createSession(db, u.id, "privy", T0);
    const seenA = await readSession(db, a.token, later(10));
    await revokeSession(db, seenA!.sessionId, later(20));
    expect(await readSession(db, a.token, later(30))).toBeNull();
    expect(await readSession(db, b.token, later(30))).not.toBeNull();
  });

  it("sign out everywhere ends every session of that user and nobody else's", async () => {
    const u = await upsertWalletUser(db, wallet(4));
    const other = await upsertWalletUser(db, wallet(5));
    const a = await createSession(db, u.id, "privy", T0);
    const b = await createSession(db, u.id, "privy", T0);
    const o = await createSession(db, other.id, "privy", T0);
    await revokeAllSessions(db, u.id, later(10));
    expect(await readSession(db, a.token, later(20))).toBeNull();
    expect(await readSession(db, b.token, later(20))).toBeNull();
    expect(await readSession(db, o.token, later(20))).not.toBeNull();
  });

  it("only rewrites last-seen when it is stale", async () => {
    const u = await upsertWalletUser(db, wallet(6));
    const { token } = await createSession(db, u.id, "privy", T0);
    await readSession(db, token, later(60 * 1000));
    const [fresh] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(fresh!.lastSeenAt.getTime()).toBe(T0.getTime());
    await readSession(db, token, later(2 * 3600 * 1000));
    const [touched] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(touched!.lastSeenAt.getTime()).toBe(later(2 * 3600 * 1000).getTime());
  });
});

describe("users", () => {
  it("returns the same user for the same wallet in any letter case", async () => {
    const a = await upsertWalletUser(db, "0xAbCdEf0000000000000000000000000000000001");
    const b = await upsertWalletUser(db, "0xabcdef0000000000000000000000000000000001");
    expect(b.id).toBe(a.id);
    expect(a.email).toBeNull();
    expect((await db.select().from(users).where(eq(users.wallet, "0xabcdef0000000000000000000000000000000001"))).length).toBe(1);
  });
});
