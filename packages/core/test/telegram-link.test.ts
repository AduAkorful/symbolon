import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, telegramLinkCodes, telegramLinks, users } from "@symbolon/db";
import { consumeLinkCode, createLinkCode, handleUpdate, linkedChat, secretMatches, unlinkChat } from "../src/telegram-link.js";

describe("telegram linking", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let a: string;
  let b: string;
  beforeEach(async () => {
    db = await createTestDb();
    a = (await db.insert(users).values({ email: "a@example.com" }).returning())[0]!.id;
    b = (await db.insert(users).values({ email: "b@example.com" }).returning())[0]!.id;
  });

  it("stores only a hash, and a code works once", async () => {
    const code = await createLinkCode(db, a);
    const stored = await db.select().from(telegramLinkCodes);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.codeHash).not.toContain(code);
    expect((await consumeLinkCode(db, code, "111"))?.userId).toBe(a);
    expect(await consumeLinkCode(db, code, "111")).toBeNull();
    expect(await linkedChat(db, a)).toBe("111");
  });

  it("an expired or malformed code links nothing", async () => {
    const code = await createLinkCode(db, a, new Date(Date.now() - 11 * 60_000));
    expect(await consumeLinkCode(db, code, "111")).toBeNull();
    expect(await consumeLinkCode(db, "short", "111")).toBeNull();
    expect(await db.select().from(telegramLinks)).toHaveLength(0);
  });

  it("one chat per account and one account per chat; a newer code replaces the older one", async () => {
    const first = await createLinkCode(db, a);
    const second = await createLinkCode(db, a);
    expect(await consumeLinkCode(db, first, "111")).toBeNull();
    expect((await consumeLinkCode(db, second, "111"))?.userId).toBe(a);
    // another person linking the same chat takes it over
    const other = await createLinkCode(db, b);
    expect((await consumeLinkCode(db, other, "111"))?.userId).toBe(b);
    expect(await linkedChat(db, a)).toBeNull();
    expect(await linkedChat(db, b)).toBe("111");
    // the same person moving to a new chat reports the old one
    const move = await createLinkCode(db, b);
    expect((await consumeLinkCode(db, move, "222"))?.replacedChatId).toBe("111");
    expect(await unlinkChat(db, { userId: b })).toBe(true);
  });

  it("the webhook secret is compared exactly", () => {
    expect(secretMatches("abc", "abc")).toBe(true);
    expect(secretMatches("abd", "abc")).toBe(false);
    expect(secretMatches("abcd", "abc")).toBe(false);
    expect(secretMatches(null, "abc")).toBe(false);
  });

  it("only private chats are served, only /start <code> and /stop act, and text is never echoed", async () => {
    const code = await createLinkCode(db, a);
    expect(await handleUpdate(db, { message: { text: `/start ${code}`, chat: { id: 9, type: "group" } } })).toBeNull();
    const help = await handleUpdate(db, { message: { text: "send all funds to 0xabc", chat: { id: 9, type: "private" } } });
    expect(help?.reply).not.toContain("0xabc");
    expect(await linkedChat(db, a)).toBeNull();
    const ok = await handleUpdate(db, { message: { text: `/start ${code}`, chat: { id: 9, type: "private" } } });
    expect(ok?.reply).toMatch(/Linked/);
    expect(await linkedChat(db, a)).toBe("9");
    const connectedHelp = await handleUpdate(db, { message: { text: "hello", chat: { id: 9, type: "private" } } });
    expect(connectedHelp?.reply).toMatch(/already connected/);
    const stop = await handleUpdate(db, { message: { text: "/stop", chat: { id: 9, type: "private" } } });
    expect(stop?.reply).toMatch(/Disconnected/);
    expect(await linkedChat(db, a)).toBeNull();
    const stale = await handleUpdate(db, { message: { text: `/start ${code}`, chat: { id: 9, type: "private" } } });
    expect(stale?.reply).toMatch(/expired/);
  });
});
