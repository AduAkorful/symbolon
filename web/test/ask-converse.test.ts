import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const modelState = vi.hoisted(() => ({ current: null as import("@symbolon/steward").StewardModel | null }));
vi.mock("@/lib/server/steward-model", () => ({ getStewardModel: () => modelState.current }));
import { eq } from "drizzle-orm";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, members, users, type Database } from "@symbolon/db";
import { FakeStewardModel } from "@symbolon/steward/testing";
import type { PhraseInput, PlanResult, RouteTurn } from "@symbolon/steward";
import { askSteward } from "@/lib/server/ask";
import { checkReply } from "@/lib/server/ask-check";
import { archiveThread, deleteEarlier, deleteExpiredMessages, listEarlier, loadEarlier, loadThread, recentTurns, saveExchange, THREAD_SHOWN } from "@/lib/server/ask-store";
import { askMessages } from "@symbolon/db";

const SEAL = `0x${"ab".repeat(20)}`;
const FP1 = `0x${"11".repeat(32)}`;
const FACT = "1 invoice totaling $10.00 due within the next 7 days (INV-001).";


describe("checkReply (plan 05ze)", () => {
  const facts = [FACT, "From: stored invoice records at 8 Oct, 12:33 UTC", "Operating cash is $14,250.50 and €0.00. The Vault 0x6e79aaaa is paused."];
  const ok = (reply: string, question = "what is due?") => checkReply(reply, { facts, question });

  it("passes a faithful paraphrase that copies figures, dates and names exactly", () => {
    expect(ok("You have 1 invoice, INV-001, due within the next 7 days for $10.00.")).toEqual({ ok: true });
    expect(ok("Operating cash is $14,250.50 right now, and the Vault 0x6e79aaaa is paused.")).toEqual({ ok: true });
    expect(ok("Nothing in the stored records stands out. Is there a vendor you want me to look at?")).toEqual({ ok: true });
  });

  it("rejects a figure that is not in the facts, however it is dressed", () => {
    for (const reply of ["You owe $12.00 this week.", "About $14k in cash.", "Cash is $14,250 and change.", "You have 3 invoices due.", "That is two weeks of runway.", "Cash is 14250.5."]) {
      expect(ok(reply).ok, reply).toBe(false);
    }
  });

  it("accepts a figure the person said themselves", () => {
    expect(ok("For 30 days I would look at the invoices.", "what about 30 days").ok).toBe(true);
  });

  it("rejects a made-up address, a name that is not in the facts, links, markup and claimed actions", () => {
    for (const reply of ["The Vault 0xdeadbeef is paused.", "Mueller GmbH is due next.", "See https://example.com for details.", "Open [Treasury](/business/treasury).", "<b>Paused</b>", "I paid the invoice.", "I'll approve it now.", "I have resumed the Steward.", "There are no held invoices. Everything is flowing smoothly."]) {
      expect(ok(reply).ok, reply).toBe(false);
    }
    expect(ok("INV-001 is due soon, as the stored records say.").ok).toBe(true);
  });

  it("rejects an empty or overlong reply", () => {
    expect(ok("   ").ok).toBe(false);
    expect(ok("a ".repeat(500)).ok).toBe(false);
  });
});

describe("Ask as a conversation (plan 05ze)", () => {
  let db: Database;
  let owner: string;
  let biz: string;

  beforeEach(async () => {
    process.env.CHAIN_ID = "5042002";
    db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    owner = u!.id;
    const [b] = await db.insert(businesses).values({ name: "Acme Corp", chainId: 5042002 }).returning();
    biz = b!.id;
    await db.insert(members).values({ businessId: biz, userId: owner, role: "owner" });
  });

  const ask = (question: string) => askSteward({ db, businessId: biz, userId: owner, question });
  const store = (question: string, text: string, intent = "conversation") => saveExchange(db, { businessId: biz, userId: owner, question, answer: { text, links: [], source: "s", intent, params: {} } });
  const model = (plans: Record<string, PlanResult>, writer?: (input: PhraseInput) => string) => {
    modelState.current = new FakeStewardModel(undefined, "", {}, plans, writer);
  };
  const dueInvoice = async () => {
    const d = getDeployment(arcTestnet.id);
    await db.insert(invoices).values({ fingerprint: FP1, chainId: 5042002, ledger: d.contracts.invoiceLedger, seal: SEAL, businessId: biz, payerRef: `0x${"00".repeat(32)}`, invoiceNumber: "INV-001", token: d.tokens.usdc, total: 10_000_000n, credited: 0n, dueDate: new Date(Date.now() + 3 * 86_400_000), envelope: "{}", source: "link" });
  };

  it("runs the planned lookups, shows the model's wording when it passes, and keeps the facts for 'Show the numbers'", async () => {
    await dueInvoice();
    const seen: PhraseInput[] = [];
    model({ "anything due?": { reads: [{ intent: "payments_due", params: { days: 7 } }] } }, (i) => (seen.push(i), "Yes, 1 invoice is due this week, for $10.00 in total."));
    const res = await ask("anything due?");
    expect(res.text).toBe("Yes, 1 invoice is due this week, for $10.00 in total.");
    expect(res.intent).toBe("payments_due");
    expect(res.params).toEqual({ days: 7 });
    expect(res.facts?.[0]?.text).toContain("1 invoice totaling $10.00");
    expect(res.links.length).toBeGreaterThan(0);
    expect(seen[0]?.facts.map((f) => f.topic)).toEqual(["payments_due"]);
  });

  it("replaces a reply with an invented figure by the lookup's own sentence", async () => {
    await dueInvoice();
    model({ "anything due?": { reads: [{ intent: "payments_due", params: { days: 7 } }] } }, () => "Yes, $99.00 is due this week.");
    const res = await ask("anything due?");
    expect(res.text).toContain("1 invoice totaling $10.00");
    expect(res.facts).toBeUndefined();
  });

  it("reads several topics for one message and joins their own sentences when the reply is rejected", async () => {
    model({ "cover my bills?": { reads: [{ intent: "payments_due", params: { days: 7 } }, { intent: "held_invoices", params: {} }] } }, () => "I paid everything.");
    const res = await ask("cover my bills?");
    expect(res.text.split("\n\n")).toHaveLength(2);
    expect(res.text).toContain("No payments are due");
  });

  it("answers a greeting or a reaction without looking anything up, and says what it can do", async () => {
    const seen: PhraseInput[] = [];
    model({ hi: { reads: [] }, "I have none": { reads: [] } }, (i) => (seen.push(i), "Hello. I can look into payments, holds and cash. I can't move money from here."));
    const res = await ask("hi");
    expect(res.intent).toBe("conversation");
    expect(res.facts).toBeUndefined();
    expect(res.text).toContain("Hello");
    await ask("I have none");
    expect(seen[1]?.facts).toEqual([]);
    expect(seen[1]?.history[0]?.reply).toBe(res.text);
    expect(seen[1]?.topics.map((t) => t.name)).toContain("next_steps");
  });

  it("falls back to what Ask can do when nothing was looked up and the reply is unusable", async () => {
    model({ hi: { reads: [] } }, () => "See https://example.com");
    const res = await ask("hi");
    expect(res.text).toContain("I can look up");
    expect(res.text).toContain("can't move money");
  });

  it("asks a short question back only when the plan says a vendor is missing and the question holds no invented figure", async () => {
    model({ "how are they doing?": { reads: [], clarify: "Which vendor do you mean?" }, "x": { reads: [], clarify: "That is 42 vendors." } });
    expect((await ask("how are they doing?")).text).toBe("Which vendor do you mean?");
    expect((await ask("x")).text).not.toContain("42");
  });

  it("says plainly that the model is unavailable when planning fails, and never throws", async () => {
    const m = new FakeStewardModel();
    m.plan = async () => { throw new Error("down"); };
    modelState.current = m;
    const res = await ask("hello");
    expect(res.text).toContain("couldn't reach the language model");
  });

  it("an earlier reply cannot widen what a new reply may state", async () => {
    await store("q", "You owe $5,000.00.");
    model({ "why?": { reads: [] } }, () => "Because $5,000.00 is overdue.");
    const res = await ask("why?");
    expect(res.text).not.toContain("5,000");
  });

  it("tells the planner the person's stored thread: this person and business only, newest six, with replies", async () => {
    const [other] = await db.insert(users).values({ email: "other@acme.example" }).returning();
    await db.insert(members).values({ businessId: biz, userId: other!.id, role: "viewer" });
    await saveExchange(db, { businessId: biz, userId: other!.id, question: "someone else's question", answer: { text: "theirs", links: [], source: "s", intent: "conversation", params: {} } });
    for (let i = 0; i < 8; i++) await store(`q${i}`, `reply ${i}`);
    const seen: (RouteTurn[] | undefined)[] = [];
    const m = new FakeStewardModel();
    m.plan = async (_q, _i, history) => (seen.push(history), { reads: [] });
    modelState.current = m;
    await ask("hi");
    expect(seen[0]?.map((t) => t.question)).toEqual(["q2", "q3", "q4", "q5", "q6", "q7"]);
    expect(seen[0]?.at(-1)).toEqual({ question: "q7", intent: "conversation", params: {}, reply: "reply 7" });
  });

  it("keeps each exchange, quick questions included, and says so when one could not be kept", async () => {
    model({ "hi": { reads: [] } });
    await ask("hi");
    await askSteward({ db, businessId: biz, userId: owner, intent: "payments_due", params: { days: 7 }, question: "What are we paying this week?" });
    expect((await loadThread(db, biz, owner)).map((m) => [m.question, m.answer.intent])).toEqual([["hi", "conversation"], ["What are we paying this week?", "payments_due"]]);
    const broken = Object.assign(Object.create(db), { insert: () => { throw new Error("down"); } }) as Database;
    const res = await askSteward({ db: broken, businessId: biz, userId: owner, question: "hi" });
    expect(res.saved).toBe(false);
    expect(res.text.length).toBeGreaterThan(0);
  });
});

describe("the stored thread (plan 05zf)", () => {
  let db: Database;
  let a: string;
  let b: string;
  let biz1: string;
  let biz2: string;
  const answer = (text: string) => ({ text, links: [["Treasury", "/business/treasury"]] as [string, string][], source: "From: test", intent: "payments_due", params: { days: 7 }, facts: [{ text: "f", source: "s" }] });

  beforeEach(async () => {
    process.env.CHAIN_ID = "5042002";
    db = await createTestDb();
    const [u1, u2] = await db.insert(users).values([{ email: "a@acme.example" }, { email: "b@acme.example" }]).returning();
    a = u1!.id;
    b = u2!.id;
    const [x, y] = await db.insert(businesses).values([{ name: "One", chainId: 5042002 }, { name: "Two", chainId: 5042002 }]).returning();
    biz1 = x!.id;
    biz2 = y!.id;
  });

  it("reads back what was saved, in order, with links, facts and parameters intact", async () => {
    await saveExchange(db, { businessId: biz1, userId: a, question: "one", answer: answer("first") });
    await saveExchange(db, { businessId: biz1, userId: a, question: "two", answer: answer("second") });
    const thread = await loadThread(db, biz1, a);
    expect(thread.map((m) => m.question)).toEqual(["one", "two"]);
    expect(thread[1]?.answer).toEqual({ ...answer("second") });
  });

  it("shows only the newest messages", async () => {
    for (let i = 0; i < THREAD_SHOWN + 5; i++) await saveExchange(db, { businessId: biz1, userId: a, question: `q${i}`, answer: answer("r") });
    const thread = await loadThread(db, biz1, a);
    expect(thread).toHaveLength(THREAD_SHOWN);
    expect(thread[0]?.question).toBe("q5");
    expect(thread.at(-1)?.question).toBe(`q${THREAD_SHOWN + 4}`);
  });

  it("is private: another person or another business sees none of it", async () => {
    await saveExchange(db, { businessId: biz1, userId: a, question: "mine", answer: answer("r") });
    await saveExchange(db, { businessId: biz1, userId: b, question: "theirs", answer: answer("r") });
    await saveExchange(db, { businessId: biz2, userId: a, question: "elsewhere", answer: answer("r") });
    expect((await loadThread(db, biz1, a)).map((m) => m.question)).toEqual(["mine"]);
    expect(await loadThread(db, biz2, b)).toEqual([]);
    expect((await loadThread(db, biz1, b)).map((m) => m.question)).toEqual(["theirs"]);
  });

  it("'New conversation' moves the thread aside instead of deleting it, and a second one starts clean", async () => {
    expect(await archiveThread(db, biz1, a)).toBeNull();
    await saveExchange(db, { businessId: biz1, userId: a, question: "first question", answer: answer("r1") });
    await saveExchange(db, { businessId: biz1, userId: a, question: "second", answer: answer("r2") });
    const id = await archiveThread(db, biz1, a);
    expect(id).toBeTruthy();
    expect(await loadThread(db, biz1, a)).toEqual([]);
    expect(await recentTurns(db, biz1, a)).toEqual([]);
    await saveExchange(db, { businessId: biz1, userId: a, question: "new thread", answer: answer("r3") });
    expect((await loadThread(db, biz1, a)).map((m) => m.question)).toEqual(["new thread"]);
    const earlier = await listEarlier(db, biz1, a);
    expect(earlier).toHaveLength(1);
    expect(earlier[0]).toMatchObject({ id, title: "first question", messages: 2 });
    expect((await loadEarlier(db, biz1, a, id!)).map((m) => m.question)).toEqual(["first question", "second"]);
  });

  it("earlier conversations are the author's only, listed newest first, and deletable one at a time", async () => {
    await saveExchange(db, { businessId: biz1, userId: a, question: "old one", answer: answer("r") });
    const first = await archiveThread(db, biz1, a);
    await saveExchange(db, { businessId: biz1, userId: a, question: "newer one", answer: answer("r") });
    const second = await archiveThread(db, biz1, a);
    await saveExchange(db, { businessId: biz1, userId: b, question: "b's", answer: answer("r") });
    const bs = await archiveThread(db, biz1, b);
    expect((await listEarlier(db, biz1, a)).map((e) => e.title)).toEqual(["newer one", "old one"]);
    // another person, or the same person in another business, can't read or delete it
    expect(await loadEarlier(db, biz1, b, first!)).toEqual([]);
    expect(await loadEarlier(db, biz2, a, first!)).toEqual([]);
    expect(await deleteEarlier(db, biz1, b, first!)).toBe(0);
    expect(await deleteEarlier(db, biz1, a, bs!)).toBe(0);
    expect(await deleteEarlier(db, biz1, a, first!)).toBe(1);
    expect((await listEarlier(db, biz1, a)).map((e) => e.id)).toEqual([second]);
    expect((await listEarlier(db, biz1, b)).map((e) => e.id)).toEqual([bs]);
  });

  it("removes messages older than 30 days and nothing newer", async () => {
    await saveExchange(db, { businessId: biz1, userId: a, question: "fresh", answer: answer("r") });
    await saveExchange(db, { businessId: biz1, userId: a, question: "stale", answer: answer("r") });
    const { eq } = await import("drizzle-orm");
    await db.update(askMessages).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(askMessages.question, "stale"));
    expect(await deleteExpiredMessages(db)).toBe(1);
    expect((await loadThread(db, biz1, a)).map((m) => m.question)).toEqual(["fresh"]);
  });
});

describe("next_steps (plan 05ze)", () => {
  let db: Database;
  let owner: string;
  let biz: string;
  beforeEach(async () => {
    process.env.CHAIN_ID = "5042002";
    db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    owner = u!.id;
    const [b] = await db.insert(businesses).values({ name: "Acme Corp", chainId: 5042002 }).returning();
    biz = b!.id;
    await db.insert(members).values({ businessId: biz, userId: owner, role: "owner" });
  });

  it("says to finish setup when there is no Vault, then counts what waits, in a fixed order", async () => {
    const res = await askSteward({ db, businessId: biz, userId: owner, intent: "next_steps", params: {} });
    expect(res.text).toContain("Finish setting up your Vault");
    const d = getDeployment(arcTestnet.id);
    for (const [i, status] of (["awaiting_approval", "awaiting_approval", "held"] as const).entries()) {
      await db.insert(invoices).values({ fingerprint: `0x${String(i + 1).padStart(2, "0").repeat(32)}`, chainId: 5042002, ledger: d.contracts.invoiceLedger, seal: SEAL, businessId: biz, payerRef: `0x${"00".repeat(32)}`, invoiceNumber: `N-${i}`, token: d.tokens.usdc, total: 1_000_000n, credited: 0n, dueDate: new Date(), envelope: "{}", source: "link", status });
    }
    const next = await askSteward({ db, businessId: biz, userId: owner, intent: "next_steps", params: {} });
    expect(next.text.indexOf("Finish setting up")).toBeLessThan(next.text.indexOf("2 invoices are waiting for your approval"));
    expect(next.text.indexOf("2 invoices are waiting")).toBeLessThan(next.text.indexOf("1 invoice is on hold"));
    expect(next.links.map(([, href]) => href)).toEqual(["/business", "/business/approvals", "/business/inbox"]);
  });

  it("says nothing needs the owner when nothing does", async () => {
    await db.update(businesses).set({ vault: null }).where(eq(businesses.id, biz));
    const res = await askSteward({ db, businessId: biz, userId: owner, intent: "next_steps", params: {} });
    expect(res.text).toContain("Finish setting up");
  });
});
