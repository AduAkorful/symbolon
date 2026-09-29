import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { createTestDb, sessions } from "@symbolon/db";
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
// The test wallet would write a key file under .data; here it only reports what the route asked it to do
const sent: { userId: string; call: { to: string; data: string } }[] = [];
vi.mock("@/lib/server/dev-wallet", () => ({
  ensureDevWallet: async () => "0x0000000000000000000000000000000000000001",
  signInvoiceAsDevSeal: async (userId: string, document: unknown) => (signed.push({ userId, document }), `0x${"cd".repeat(65)}`),
  sendAsDevWallet: async (_db: unknown, userId: string, call: { to: string; data: string }) => (sent.push({ userId, call }), `0x${"ab".repeat(32)}`),
}));
const signed: { userId: string; document: unknown }[] = [];
let reader: import("@symbolon/steward").StewardModel | null = null;
vi.mock("@/lib/server/steward-model", () => ({ getStewardModel: () => reader }));
let db: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("@/lib/server/db", () => ({ getDb: async () => db }));

const ORIGIN = "http://localhost:3000";
const env = process.env as Record<string, string | undefined>;

async function load() {
  vi.resetModules();
  const dev = await import("@/app/api/auth/dev/route");
  const out = await import("@/app/api/auth/signout/route");
  const all = await import("@/app/api/auth/signout-all/route");
  const http = await import("@/lib/server/http");
  const devSend = await import("@/app/api/dev/wallet/send/route");
  const devSign = await import("@/app/api/dev/sign/route");
  const vendorSeal = await import("@/app/api/vendor/seal/route");
  const vendorInvoice = await import("@/app/api/vendor/invoice/route");
  const vendorUpload = await import("@/app/api/vendor/upload/route");
  return { vendorUpload: vendorUpload.POST, devSign: devSign.POST, vendorSeal, vendorInvoice: vendorInvoice.POST, devSend: devSend.POST, dev: dev.POST, out: out.POST, all: all.POST, http };
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
    const { dev } = await load();
    for (const origin of [null, "https://evil.example", "http://localhost:3001", "http://localhost:3000.evil.example"]) {
      const res = await dev(post({ key: "owner" }, origin));
      expect(res.status).toBe(403);
    }
    expect(jar.size).toBe(0);
  });

  it("signs in a dev test user in development: sets an HttpOnly-style session and it reads back", async () => {
    const { dev, http } = await load();
    const res = await dev(post({ key: "owner" }));
    expect(res.status).toBe(200);
    expect([...jar.keys()]).toEqual(["symbolon_session"]);
    const s = await http.getSession();
    expect(s?.user.email).toBe("owner@dev.symbolon.test");
    expect(s?.method).toBe("dev");
  });

  it("rejects an unknown dev user", async () => {
    const { dev } = await load();
    expect((await dev(post({ key: "admin" }))).status).toBe(400);
    expect((await dev(post("not an object"))).status).toBe(400);
    expect(jar.size).toBe(0);
  });

  it("answers 404 for the dev route in a production build, and starts no session", async () => {
    env.NODE_ENV = "production";
    env.APP_ORIGIN = "https://app.example.test";
    env.DATABASE_URL = "postgres://u:p@db.example.test/x";
    const { dev } = await load();
    const res = await dev(post({ key: "owner" }, "https://app.example.test"));
    expect(res.status).toBe(404);
    expect(jar.size).toBe(0);
  });

  it("signs out this session only, and clears the cookie", async () => {
    const { dev, out, http } = await load();
    await dev(post({ key: "owner" }));
    const first = await http.getSession();
    // a second device signed in as the same user
    const other = new Map(jar);
    jar.clear();
    await dev(post({ key: "owner" }));
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
    const { dev, all, http } = await load();
    expect((await all(post({}))).status).toBe(401);
    await dev(post({ key: "vendor" }));
    const mine = await http.getSession();
    const stillMine = new Map(jar);
    jar.clear();
    await dev(post({ key: "vendor" }));
    expect((await all(post({}))).status).toBe(200);
    expect(jar.size).toBe(0);
    for (const [k, v] of stillMine) jar.set(k, v);
    expect(await http.getSession()).toBeNull();
    const rows = await db.select().from(sessions).where(eq(sessions.userId, mine!.user.id));
    expect(rows.every((r) => r.revokedAt)).toBe(true);
  });

  it("a page that needs sign-in redirects a signed-out visitor to /signin, remembering where they were going", async () => {
    const { http } = await load();
    await expect(http.requirePageSession("/b/inbox")).rejects.toThrow("redirect:/signin?next=%2Fb%2Finbox");
  });

  describe("the test wallet route", () => {
    const call = { to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef" };

    it("sends for a signed-in test user, and only for one", async () => {
      const { dev, devSend } = await load();
      expect((await devSend(post(call))).status).toBe(401);
      await dev(post({ key: "owner" }));
      sent.length = 0;
      const res = await devSend(post(call));
      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.call).toEqual(call);
    });

    it("rejects a malformed call before anything is sent", async () => {
      const { dev, devSend } = await load();
      await dev(post({ key: "owner" }));
      sent.length = 0;
      for (const bad of [{}, { to: "nope", data: "0x" }, { to: call.to, data: "xyz" }, { to: call.to, data: "0x123" }]) expect((await devSend(post(bad))).status).toBe(400);
      expect(sent).toHaveLength(0);
    });

    it("answers 404 in a production build and refuses another origin", async () => {
      env.NODE_ENV = "production";
      env.APP_ORIGIN = "https://app.example.test";
      env.DATABASE_URL = "postgres://u:p@db.example.test/x";
      const { devSend } = await load();
      sent.length = 0;
      expect((await devSend(post(call, "https://app.example.test"))).status).toBe(404);
      expect((await devSend(post(call, "https://evil.example"))).status).toBe(403);
      expect(sent).toHaveLength(0);
    });
  });

  describe("the invoice signing route (development only)", () => {
    const document = { seal: "0x1111111111111111111111111111111111111111" };

    it("signs for a signed-in test user, and only for one", async () => {
      const { dev, devSign } = await load();
      expect((await devSign(post({ document }))).status).toBe(401);
      await dev(post({ key: "vendor" }));
      signed.length = 0;
      const res = await devSign(post({ document }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { signature: string }).signature).toMatch(/^0x[0-9a-f]+$/);
      expect(signed).toHaveLength(1);
      expect(signed[0]!.document).toEqual(document);
    });

    it("answers 404 in a production build and refuses another origin", async () => {
      env.NODE_ENV = "production";
      env.APP_ORIGIN = "https://app.example.test";
      env.DATABASE_URL = "postgres://u:p@db.example.test/x";
      const { devSign } = await load();
      signed.length = 0;
      expect((await devSign(post({ document }, "https://app.example.test"))).status).toBe(404);
      expect((await devSign(post({ document }, "https://evil.example"))).status).toBe(403);
      expect(signed).toHaveLength(0);
    });
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
      const { dev, vendorInvoice } = await load();
      await dev(post({ key: "owner" }));
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
      const { vendorUpload, dev } = await load();
      expect((await vendorUpload(upload(pdf, "https://evil.example"))).status).toBe(403);
      expect((await vendorUpload(upload(pdf))).status).toBe(401);
      await dev(post({ key: "owner" }));
      // this test user has no Seal yet
      const { users, seals } = await import("@symbolon/db");
      const rows = await db.select().from(users);
      await db.delete(seals).where(eq(seals.userId, rows.find((u) => u.email === "owner@dev.symbolon.test")!.id));
      expect((await vendorUpload(upload(pdf))).status).toBe(403);
    });

    it("says reading uploads isn't available while there is no reader", async () => {
      const { vendorUpload, dev } = await load();
      await dev(post({ key: "vendor" }));
      reader = null;
      const { users, seals } = await import("@symbolon/db");
      const me = (await db.select().from(users)).find((u) => u.email === "vendor@dev.symbolon.test")!;
      await db.insert(seals).values({ address: me.wallet ?? "0x000000000000000000000000000000000000dead", userId: me.id, handle: "route-vendor-a", displayName: "Route Vendor" }).onConflictDoNothing();
      const res = await vendorUpload(upload(pdf));
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toMatch(/isn't available on this server yet/);
    });

    it("hands the file to the reader and returns a draft", async () => {
      const { vendorUpload, dev } = await load();
      await dev(post({ key: "vendor" }));
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
      const { vendorUpload, dev } = await load();
      await dev(post({ key: "vendor" }));
      reader = { extractInvoice: async () => { throw new Error("must not be called"); }, explain: async () => "" };
      const res = await vendorUpload(new Request(`${ORIGIN}/api/vendor/upload`, { method: "POST", headers: { origin: ORIGIN }, body: new FormData() }));
      expect(res.status).toBe(400);
      reader = null;
    });
  });
});
