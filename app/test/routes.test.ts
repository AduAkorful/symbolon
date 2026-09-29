import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { createTestDb, seals, sessions, users } from "@symbolon/db";
import { eq } from "drizzle-orm";

// Route handlers import server-only modules and Next's cookie store. Stand both in: a Map for cookies, the test database for getDb.
vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o?: { maxAge?: number }) => (v === "" || o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
// Privy itself is replaced by a stand-in that knows one person; the route still does everything else for real
const privyView = { id: "did:privy:route-1", email: "route@example.test", wallets: [{ address: "0x00000000000000000000000000000000000000b1", kind: "embedded" as const }] };
vi.mock("@/lib/server/privy", () => ({
  getPrivy: () => ({
    appId: "app-1",
    verifyAccessToken: async (t: string) => { if (t !== "good.token.here") throw new Error("bad"); return { userId: privyView.id, appId: "app-1" }; },
    getUser: async () => privyView,
  }),
}));
let reader: import("@symbolon/steward").StewardModel | null = null;
vi.mock("@/lib/server/steward-model", () => ({ getStewardModel: () => reader }));
let db: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("@/lib/server/db", () => ({ getDb: async () => db }));

const ORIGIN = "http://localhost:3000";
const env = process.env as Record<string, string | undefined>;

async function load() {
  vi.resetModules();
  const privySignIn = await import("@/app/api/auth/privy/route");
  const out = await import("@/app/api/auth/signout/route");
  const all = await import("@/app/api/auth/signout-all/route");
  const http = await import("@/lib/server/http");
  const vendorSeal = await import("@/app/api/vendor/seal/route");
  const vendorInvoice = await import("@/app/api/vendor/invoice/route");
  const vendorUpload = await import("@/app/api/vendor/upload/route");
  const { createSession } = await import("@/lib/server/session");
  // Signs a person in the way the wallet route ends: a user row, a session, the cookie
  const signIn = async (who: "owner" | "vendor") => {
    const email = `${who}@example.test`;
    const wallet = who === "owner" ? "0x00000000000000000000000000000000000000a1" : "0x00000000000000000000000000000000000000a2";
    const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found ?? (await db.insert(users).values({ email, wallet }).returning())[0]!;
    const { token } = await createSession(db, user.id, "privy");
    jar.set(http.sessionCookieName(), token);
    return user;
  };
  return { privySignIn: privySignIn.POST, vendorUpload: vendorUpload.POST, vendorSeal, vendorInvoice: vendorInvoice.POST, signIn, out: out.POST, all: all.POST, http };
}

const post = (body: unknown, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/auth/x`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(() => {
  jar.clear();
  env.CHAIN_ID = String(arcTestnet.id);
  env.NODE_ENV = "test";
  delete env.APP_ORIGIN;
  delete env.DATABASE_URL;
});

describe("auth routes", () => {
  it("refuses any POST that doesn't come from the app's own origin (missing, other, or lookalike)", async () => {
    const { signIn, out, http } = await load();
    await signIn("owner");
    const before = new Map(jar);
    for (const origin of [null, "https://evil.example", "http://localhost:3001", "http://localhost:3000.evil.example"]) {
      const res = await out(post({}, origin));
      expect(res.status).toBe(403);
    }
    expect(jar).toEqual(before);
    expect(await http.getSession()).not.toBeNull();
  });

  it("signs in with Privy's token alone: identity comes from Privy, never from the request body", async () => {
    const { privySignIn, http } = await load();
    const res = await privySignIn(post({ accessToken: "good.token.here", userId: "did:privy:attacker", wallet: "0x00000000000000000000000000000000000000ff", email: "boss@bank.example" }));
    expect(res.status).toBe(200);
    expect([...jar.keys()]).toEqual(["symbolon_session"]);
    const s = await http.getSession();
    expect(s?.method).toBe("privy");
    expect(s?.user).toMatchObject({ privyUserId: privyView.id, email: "route@example.test", wallet: privyView.wallets[0]!.address });
  });

  it("starts no session for a bad token, a missing token, or another origin", async () => {
    const { privySignIn } = await load();
    expect((await privySignIn(post({ accessToken: "bad.token.here" }))).status).toBe(401);
    expect((await privySignIn(post({}))).status).toBe(401);
    expect((await privySignIn(post({ accessToken: "good.token.here" }, "https://evil.example"))).status).toBe(403);
    expect(jar.size).toBe(0);
  });

  it("signs out this session only, and clears the cookie", async () => {
    const { signIn, out, http } = await load();
    await signIn("owner");
    const first = await http.getSession();
    // a second device signed in as the same user
    const other = new Map(jar);
    jar.clear();
    await signIn("owner");
    const second = await http.getSession();
    expect(second!.sessionId).not.toBe(first!.sessionId);
    const res = await out(post({}));
    expect(res.status).toBe(200);
    expect(jar.size).toBe(0);
    expect(await http.getSession()).toBeNull();
    for (const [k, v] of other) jar.set(k, v);
    expect((await http.getSession())?.sessionId).toBe(first!.sessionId);
  });

  it("signing out while already signed out is fine", async () => {
    const { out } = await load();
    expect((await out(post({}))).status).toBe(200);
  });

  it("sign out everywhere ends every session of the user, and needs a session to do it", async () => {
    const { signIn, all, http } = await load();
    expect((await all(post({}))).status).toBe(401);
    await signIn("vendor");
    const mine = await http.getSession();
    const stillMine = new Map(jar);
    jar.clear();
    await signIn("vendor");
    expect((await all(post({}))).status).toBe(200);
    expect(jar.size).toBe(0);
    for (const [k, v] of stillMine) jar.set(k, v);
    expect(await http.getSession()).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, mine!.user.id));
    expect(rows.every((r) => r.revokedAt)).toBe(true);
  });

  it("a page that needs sign-in redirects a signed-out visitor to /signin, remembering where they were going", async () => {
    const { http } = await load();
    await expect(http.requirePageSession("/business/inbox")).rejects.toThrow("redirect:/signin?next=%2Fbusiness%2Finbox");
  });

  describe("the vendor routes", () => {
    it("need a session and the app's own origin", async () => {
      const { vendorSeal, vendorInvoice } = await load();
      expect((await vendorSeal.POST(post({ handle: "x-y-z", displayName: "Nope" }))).status).toBe(401);
      expect((await vendorInvoice(post({ action: "prepare", draft: {} }))).status).toBe(401);
      expect((await vendorInvoice(post({ action: "prepare", draft: {} }, "https://evil.example"))).status).toBe(403);
      const anon = await vendorSeal.GET(new Request(`${ORIGIN}/api/vendor/seal?handle=abc`));
      expect(anon.status).toBe(401);
    });

    it("refuse an unknown action, and a vendor action from someone with no Seal", async () => {
      const { signIn, vendorInvoice } = await load();
      await signIn("owner");
      expect((await vendorInvoice(post({ action: "explode" }))).status).toBe(400);
    });
  });

  describe("the upload route", () => {
    const upload = (bytes: Uint8Array | string, origin: string | null = ORIGIN) => {
      const body = new FormData();
      body.append("file", new Blob([bytes as BlobPart]), "invoice.pdf");
      return new Request(`${ORIGIN}/api/vendor/upload`, { method: "POST", headers: origin ? { origin } : {}, body });
    };
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

    it("needs a session, the app's origin and a Seal", async () => {
      const { vendorUpload, signIn } = await load();
      expect((await vendorUpload(upload(pdf, "https://evil.example"))).status).toBe(403);
      expect((await vendorUpload(upload(pdf))).status).toBe(401);
      await signIn("owner");
      // this person has no Seal yet
      expect((await vendorUpload(upload(pdf))).status).toBe(403);
    });

    it("says reading uploads isn't available while there is no reader", async () => {
      const { vendorUpload, signIn } = await load();
      const me = await signIn("vendor");
      reader = null;
      await db.insert(seals).values({ address: me.wallet!, userId: me.id, handle: "route-vendor-a", displayName: "Route Vendor" }).onConflictDoNothing();
      const res = await vendorUpload(upload(pdf));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toMatch(/isn't available on this server yet/);
    });

    it("hands the file to the reader and returns a draft", async () => {
      const { vendorUpload, signIn } = await load();
      await signIn("vendor");
      const seen: unknown[] = [];
      reader = {
        extractInvoice: async (i) => (
          seen.push(i),
          {
            invoiceNumber: "7", issueDate: "2026-09-01", dueDate: "2026-09-30", vendorName: "V", vendorEmail: null, payerName: "Acme", payerEmail: null, currency: "USD", poNumber: null,
            lineItems: [{ description: "Work", quantity: "1", unitPrice: "10" }], taxes: [], discounts: [], total: "10", terms: null, notes: null, instructionsFound: [],
          }
        ),
        explain: async () => "",
      };
      const res = await vendorUpload(upload(pdf));
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; prefill: { client: { name: string }; dueDays: string } };
      expect(json.ok).toBe(true);
      expect(json.prefill.client.name).toBe("Acme");
      expect(json.prefill.dueDays).toBe("29");
      expect(seen).toHaveLength(1);
      reader = null;
    });

    it("refuses a request with no file", async () => {
      const { vendorUpload, signIn } = await load();
      await signIn("vendor");
      reader = { extractInvoice: async () => { throw new Error("must not be called"); }, explain: async () => "" };
      const res = await vendorUpload(new Request(`${ORIGIN}/api/vendor/upload`, { method: "POST", headers: { origin: ORIGIN }, body: new FormData() }));
      expect(res.status).toBe(400);
      reader = null;
    });
  });
});
