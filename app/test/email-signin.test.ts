import { beforeAll, describe, expect, it } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { createTestDb, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { circleBlockchain, createCircleAuth, type CircleAuth, type CircleWallet } from "@/lib/server/circle-auth";
import { EMAIL_CHALLENGE_TTL_MS, completeEmailSignIn, startEmailSignIn } from "@/lib/server/email-signin";
import { AuthError } from "@/lib/server/errors";
import { upsertWalletUser } from "@/lib/server/users";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const T0 = new Date("2026-09-29T10:00:00Z");
const chainId = arcTestnet.id;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/** A stand-in for Circle: which token belongs to which Circle user, and which wallets each user has */
function fakeCircle() {
  const wallets = new Map<string, CircleWallet[]>(); // by user token
  const calls = { otp: [] as { deviceId: string; email: string }[], init: 0 };
  const circle: CircleAuth = {
    async requestEmailOtp(a) {
      calls.otp.push(a);
      return { deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" };
    },
    async initializeUser(token) {
      calls.init++;
      return wallets.has(token) && wallets.get(token)!.length ? { alreadyInitialized: true } : { challengeId: "circle-challenge-1" };
    },
    async listWallets(token) {
      if (!token.startsWith("valid-")) throw new AuthError(401, "That sign-in isn't valid or has expired. Start again.");
      return wallets.get(token) ?? [];
    },
  };
  const give = (token: string, userId: string, n: number, over: Partial<CircleWallet> = {}) =>
    wallets.set(token, [{ id: `w${n}`, address: addr(n), blockchain: circleBlockchain(chainId), state: "LIVE", userId, accountType: "EOA", ...over }]);
  return { circle, calls, give };
}

const refused = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  return e as AuthError;
};

describe("email sign-in through Circle", () => {
  it("asks Circle for a code for the trimmed, lowercased email and remembers that email server-side", async () => {
    const f = fakeCircle();
    const r = await startEmailSignIn(db, f.circle, { email: "  Ana@Studio-Ana.COM ", deviceId: "dev-1" }, T0);
    expect(f.calls.otp).toEqual([{ deviceId: "dev-1", email: "ana@studio-ana.com" }]);
    expect(r).toMatchObject({ deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" });
    expect(r.challengeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a bad email or a missing device without asking Circle", async () => {
    const f = fakeCircle();
    expect((await refused(startEmailSignIn(db, f.circle, { email: "nope", deviceId: "d" }, T0))).status).toBe(400);
    expect((await refused(startEmailSignIn(db, f.circle, { email: "a@b.example", deviceId: "" }, T0))).status).toBe(400);
    expect(f.calls.otp).toHaveLength(0);
  });

  it("limits codes per address per hour", async () => {
    const f = fakeCircle();
    for (let i = 0; i < 5; i++) await startEmailSignIn(db, f.circle, { email: "many@codes.example", deviceId: "d" }, T0);
    expect((await refused(startEmailSignIn(db, f.circle, { email: "many@codes.example", deviceId: "d" }, T0))).status).toBe(429);
    // an hour later it works again
    await startEmailSignIn(db, f.circle, { email: "many@codes.example", deviceId: "d" }, new Date(T0.getTime() + 61 * 60 * 1000));
  });

  it("signs in a first-time user with the challenge's email and the wallet Circle reports", async () => {
    const f = fakeCircle();
    f.give("valid-tok-1", "circle-user-1", 101);
    const { challengeId } = await startEmailSignIn(db, f.circle, { email: "first@time.example", deviceId: "d" }, T0);
    const r = await completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-1", chainId }, T0);
    expect(r.status).toBe("signed-in");
    if (r.status !== "signed-in") return;
    expect(r.user).toMatchObject({ email: "first@time.example", wallet: addr(101), circleUserId: "circle-user-1" });
  });

  it("asks for the wallet step when the user has no wallet yet, and leaves the challenge open for the retry", async () => {
    const f = fakeCircle();
    const { challengeId } = await startEmailSignIn(db, f.circle, { email: "new@wallet.example", deviceId: "d" }, T0);
    const first = await completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-2", chainId }, T0);
    expect(first).toEqual({ status: "needs-wallet", walletChallengeId: "circle-challenge-1" });
    f.give("valid-tok-2", "circle-user-2", 102);
    const second = await completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-2", chainId }, T0);
    expect(second.status).toBe("signed-in");
  });

  it("counts a challenge once", async () => {
    const f = fakeCircle();
    f.give("valid-tok-3", "circle-user-3", 103);
    const { challengeId } = await startEmailSignIn(db, f.circle, { email: "once@only.example", deviceId: "d" }, T0);
    await completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-3", chainId }, T0);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-3", chainId }, T0))).status).toBe(401);
  });

  it("refuses an expired challenge, an unknown one, and a token Circle rejects (creating no user)", async () => {
    const f = fakeCircle();
    const { challengeId } = await startEmailSignIn(db, f.circle, { email: "late@one.example", deviceId: "d" }, T0);
    const late = new Date(T0.getTime() + EMAIL_CHALLENGE_TTL_MS + 1000);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-x", chainId }, late))).status).toBe(401);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId: "00000000-0000-0000-0000-000000000000", userToken: "valid-x", chainId }, T0))).status).toBe(401);
    const fresh = await startEmailSignIn(db, f.circle, { email: "bad@token.example", deviceId: "d" }, T0);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId: fresh.challengeId, userToken: "forged", chainId }, T0))).status).toBe(401);
    expect(await db.select().from(users).where(eq(users.email, "bad@token.example"))).toHaveLength(0);
  });

  it("never signs in with a wallet on another chain, or one that isn't live", async () => {
    const f = fakeCircle();
    f.give("valid-tok-4", "circle-user-4", 104, { blockchain: "ETH-SEPOLIA" });
    const { challengeId } = await startEmailSignIn(db, f.circle, { email: "wrong@chain.example", deviceId: "d" }, T0);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-4", chainId }, T0))).status).toBe(409);
    // a wallet that exists but isn't live is never signed in with, and there's nothing to re-create
    f.give("valid-tok-4", "circle-user-4", 104, { state: "FROZEN" });
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId, userToken: "valid-tok-4", chainId }, T0))).status).toBe(409);
  });

  it("signs a returning Circle user into their own account, whatever email the new challenge names", async () => {
    const f = fakeCircle();
    f.give("valid-tok-5", "circle-user-5", 105);
    const a = await startEmailSignIn(db, f.circle, { email: "ret@urning.example", deviceId: "d" }, T0);
    const first = await completeEmailSignIn(db, f.circle, { challengeId: a.challengeId, userToken: "valid-tok-5", chainId }, T0);
    const b = await startEmailSignIn(db, f.circle, { email: "other@name.example", deviceId: "d" }, T0);
    const again = await completeEmailSignIn(db, f.circle, { challengeId: b.challengeId, userToken: "valid-tok-5", chainId }, T0);
    if (first.status !== "signed-in" || again.status !== "signed-in") throw new Error("expected sign-ins");
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.email).toBe("ret@urning.example");
  });

  it("never merges into an existing account that has the same email or wallet", async () => {
    const f = fakeCircle();
    await db.insert(users).values({ email: "taken@mail.example" });
    f.give("valid-tok-6", "circle-user-6", 106);
    const a = await startEmailSignIn(db, f.circle, { email: "taken@mail.example", deviceId: "d" }, T0);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId: a.challengeId, userToken: "valid-tok-6", chainId }, T0))).status).toBe(409);

    await upsertWalletUser(db, addr(107));
    f.give("valid-tok-7", "circle-user-7", 107);
    const b = await startEmailSignIn(db, f.circle, { email: "fresh@mail.example", deviceId: "d" }, T0);
    expect((await refused(completeEmailSignIn(db, f.circle, { challengeId: b.challengeId, userToken: "valid-tok-7", chainId }, T0))).status).toBe(409);
    expect(await db.select().from(users).where(eq(users.circleUserId, "circle-user-7"))).toHaveLength(0);
  });
});

describe("Circle client", () => {
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  const client = (fetchImpl: typeof fetch) => createCircleAuth({ apiKey: "KEY", baseUrl: "https://circle.test" }, fetchImpl);

  it("sends the API key and, where needed, the user token, and reads Circle's shapes", async () => {
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const c = client(async (url, init) => {
      seen.push({ url: String(url), headers: init!.headers as Record<string, string>, ...(init!.body ? { body: String(init!.body) } : {}) });
      return String(url).endsWith("/wallets")
        ? ok({ wallets: [{ id: "w", address: "0xAB", blockchain: "ARC-TESTNET", state: "LIVE", userId: "u", accountType: "EOA" }] })
        : ok({ deviceToken: "a", deviceEncryptionKey: "b", otpToken: "c" });
    });
    await c.requestEmailOtp({ deviceId: "d", email: "a@b.example" });
    const w = await c.listWallets("USER-TOKEN");
    expect(seen[0]!.url).toBe("https://circle.test/v1/w3s/users/email/token");
    expect(seen[0]!.headers.Authorization).toBe("Bearer KEY");
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ deviceId: "d", email: "a@b.example" });
    expect(seen[1]!.headers["X-User-Token"]).toBe("USER-TOKEN");
    expect(w[0]).toMatchObject({ address: "0xab", userId: "u" });
  });

  it("asks for an EOA on the chain's Circle blockchain, and treats code 155106 as already initialized", async () => {
    let body = "";
    const c = client(async (_u, init) => {
      body = String(init!.body);
      return new Response(JSON.stringify({ code: 155106 }), { status: 409 });
    });
    expect(await c.initializeUser("t", chainId)).toEqual({ alreadyInitialized: true });
    expect(JSON.parse(body)).toMatchObject({ accountType: "EOA", blockchains: ["ARC-TESTNET"] });
  });

  it("maps a 401 to a sign-in that expired, and any outage to a 502 with no secrets in the message", async () => {
    const c401 = client(async () => new Response("{}", { status: 401 }));
    expect((await refused(c401.listWallets("t"))).status).toBe(401);
    const down = client(async () => {
      throw new Error("connect ECONNREFUSED with key KEY");
    });
    const e = await refused(down.listWallets("t"));
    expect(e.status).toBe(502);
    expect(e.message).not.toMatch(/KEY|ECONNREFUSED/);
    const bad = client(async () => ok({ nothing: true }));
    expect((await refused(bad.requestEmailOtp({ deviceId: "d", email: "a@b.example" }))).status).toBe(502);
  });

  it("knows Circle's names for both Arc chains and refuses any other", () => {
    expect(circleBlockchain(chainId)).toBe("ARC-TESTNET");
    expect(() => circleBlockchain(1)).toThrow();
  });
});
