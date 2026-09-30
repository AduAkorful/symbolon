import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { businesses, createTestDb, members, users } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o?: { maxAge?: number }) => (v === "" || o?.maxAge === 0 ? jar.delete(n) : jar.set(n, v)),
  }),
}));

let db: Awaited<ReturnType<typeof createTestDb>>;
vi.mock("@/lib/server/db", () => ({ getDb: async () => db }));

const ORIGIN = "http://localhost:3000";
const env = process.env as Record<string, string | undefined>;

async function load() {
  const stewardRoute = await import("@/app/api/business/[id]/steward/route");
  const cronRoute = await import("@/app/api/cron/steward/route");
  const http = await import("@/lib/server/http");
  const { createSession } = await import("@/lib/server/session");

  const signIn = async (role: "owner" | "approver" | "viewer") => {
    const email = `${role}@example.test`;
    const wallet = `0x00000000000000000000000000000000000000${role === "owner" ? "11" : role === "approver" ? "22" : "33"}`;
    const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = found ?? (await db.insert(users).values({ email, wallet }).returning())[0]!;
    const { token } = await createSession(db, user.id, "privy");
    jar.set(http.sessionCookieName(), token);
    return user;
  };

  return {
    stewardGet: stewardRoute.GET,
    stewardPost: stewardRoute.POST,
    cronPost: cronRoute.POST,
    signIn,
    http,
  };
}

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  jar.clear();
  env.CHAIN_ID = String(arcTestnet.id);
  env.NODE_ENV = "test";
  delete env.APP_ORIGIN;
  delete env.CRON_SECRET;
});

describe("steward api routes", () => {
  it("GET /api/business/[id]/steward requires authentication (401)", async () => {
    const { stewardGet } = await load();
    const res = await stewardGet(req("GET", "/api/business/b-1/steward"), {
      params: Promise.resolve({ id: "b-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/business/[id]/steward requires membership (403)", async () => {
    const { stewardGet, signIn } = await load();
    await signIn("owner");

    const [b] = await db.insert(businesses).values({ name: "Other Biz", chainId: arcTestnet.id }).returning();

    const res = await stewardGet(req("GET", `/api/business/${b!.id}/steward`), {
      params: Promise.resolve({ id: b!.id }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/business/[id]/steward refuses wrong origin (403)", async () => {
    const { stewardPost, signIn } = await load();
    const user = await signIn("owner");

    const [b] = await db.insert(businesses).values({ name: "Test Biz", chainId: arcTestnet.id }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: user.id, role: "owner" });

    const evilReq = new Request(`${ORIGIN}/api/business/${b!.id}/steward`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ action: "run" }),
    });

    const res = await stewardPost(evilReq, { params: Promise.resolve({ id: b!.id }) });
    expect(res.status).toBe(403);
  });

  it("POST action=mode requires owner role (403 for approver)", async () => {
    const { stewardPost, signIn } = await load();
    const user = await signIn("approver");

    const [b] = await db.insert(businesses).values({ name: "Test Biz", chainId: arcTestnet.id }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: user.id, role: "approver" });

    const res = await stewardPost(
      req("POST", `/api/business/${b!.id}/steward`, { action: "mode", mode: "assist" }),
      { params: Promise.resolve({ id: b!.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("POST action=mode allows owner to switch to assist", async () => {
    const { stewardPost, signIn } = await load();
    const user = await signIn("owner");

    const [b] = await db.insert(businesses).values({ name: "Test Biz", chainId: arcTestnet.id }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: user.id, role: "owner" });

    const res = await stewardPost(
      req("POST", `/api/business/${b!.id}/steward`, { action: "mode", mode: "assist" }),
      { params: Promise.resolve({ id: b!.id }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, mode: "assist" });
  });

  it("POST action=unknown returns 400", async () => {
    const { stewardPost, signIn } = await load();
    const user = await signIn("owner");

    const [b] = await db.insert(businesses).values({ name: "Test Biz", chainId: arcTestnet.id }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: user.id, role: "owner" });

    const res = await stewardPost(
      req("POST", `/api/business/${b!.id}/steward`, { action: "non_existent" }),
      { params: Promise.resolve({ id: b!.id }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("cron scheduler route", () => {
  it("returns 503 if CRON_SECRET is not configured", async () => {
    const { cronPost } = await load();
    delete env.CRON_SECRET;

    const res = await cronPost(req("POST", "/api/cron/steward"));
    expect(res.status).toBe(503);
  });

  it("returns 401 if authorization header is invalid", async () => {
    const { cronPost } = await load();
    env.CRON_SECRET = "super-secret-cron-token";

    const res = await cronPost(
      req("POST", "/api/cron/steward", undefined, {
        authorization: "Bearer wrong-token",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("executes when authorized with bearer token", async () => {
    const { cronPost } = await load();
    env.CRON_SECRET = "super-secret-cron-token";

    const res = await cronPost(
      req("POST", "/api/cron/steward", undefined, {
        authorization: "Bearer super-secret-cron-token",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processed).toBeDefined();
    expect(Array.isArray(data.businesses)).toBe(true);
  });
});
