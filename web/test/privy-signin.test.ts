import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, users } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@privy-io/node", () => ({ PrivyClient: class {} }));
vi.mock("@/lib/server/config", () => ({ getConfig: () => ({ privy: undefined }) }));

import { chooseWallet, signInWithPrivy, type PrivyLike, type PrivyUserView } from "@/lib/server/privy-signin";
import { viewUser } from "@/lib/server/privy";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });

const APP = "app-1";
const TOKEN = "aaa.bbb.ccc";
let n = 0;
const wallet = () => `0x${(++n).toString(16).padStart(40, "0")}`;

function fake(view: PrivyUserView, o: { appId?: string; userId?: string; verifyFails?: boolean; getFails?: boolean } = {}): PrivyLike {
  return {
    appId: APP,
    async verifyAccessToken() {
      if (o.verifyFails) throw new Error("expired");
      return { userId: o.userId ?? view.id, appId: o.appId ?? APP };
    },
    async getUser() {
      if (o.getFails) throw new Error("down");
      return view;
    },
  };
}
const view = (over: Partial<PrivyUserView> = {}): PrivyUserView => ({ id: `did:privy:${++n}`, email: null, wallets: [], ...over });
const rows = () => db.select().from(users);

describe("signing in with Privy", () => {
  it("makes an account from an email and its embedded wallet", async () => {
    const w = wallet();
    const v = view({ email: "ana@example.test", wallets: [{ address: w, kind: "embedded" }] });
    const user = await signInWithPrivy(db, fake(v), TOKEN);
    expect(user).toMatchObject({ privyUserId: v.id, email: "ana@example.test", wallet: w });
  });

  it("prefers the wallet the person already had over the one Privy made", async () => {
    const embedded = wallet();
    const external = wallet();
    const v = view({ wallets: [{ address: embedded, kind: "embedded" }, { address: external, kind: "external" }] });
    expect(chooseWallet(v.wallets)).toBe(external);
    expect((await signInWithPrivy(db, fake(v), TOKEN)).wallet).toBe(external);
  });

  it("creates nothing while the wallet is still being made", async () => {
    const v = view({ email: "wait@example.test" });
    await expect(signInWithPrivy(db, fake(v), TOKEN)).rejects.toMatchObject({ status: 503 });
    expect((await rows()).some((u) => u.privyUserId === v.id)).toBe(false);
  });

  it.each([undefined, "", "not a jwt", 5, "a.b", "a.b.c.d"])("refuses the token %j before asking Privy anything", async (token) => {
    const v = view({ wallets: [{ address: wallet(), kind: "embedded" }] });
    const privy = fake(v);
    const spy = vi.spyOn(privy, "verifyAccessToken");
    await expect(signInWithPrivy(db, privy, token)).rejects.toMatchObject({ status: 401 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an expired token, a token for another app, and a user id that does not match the token", async () => {
    const v = view({ wallets: [{ address: wallet(), kind: "embedded" }] });
    await expect(signInWithPrivy(db, fake(v, { verifyFails: true }), TOKEN)).rejects.toMatchObject({ status: 401 });
    await expect(signInWithPrivy(db, fake(v, { appId: "other-app" }), TOKEN)).rejects.toMatchObject({ status: 401 });
    const other = { ...v, id: "did:privy:someone-else" };
    await expect(signInWithPrivy(db, fake(other, { userId: v.id }), TOKEN)).rejects.toMatchObject({ status: 401 });
    expect((await rows()).some((u) => u.privyUserId === v.id || u.privyUserId === other.id)).toBe(false);
  });

  it("fails closed, creating no one, when Privy cannot be reached", async () => {
    const v = view({ wallets: [{ address: wallet(), kind: "embedded" }] });
    await expect(signInWithPrivy(db, fake(v, { getFails: true }), TOKEN)).rejects.toMatchObject({ status: 503 });
    expect((await rows()).some((u) => u.privyUserId === v.id)).toBe(false);
  });

  it("returns the same account each time, and never changes its wallet when the linked wallets change", async () => {
    const first = wallet();
    const v = view({ wallets: [{ address: first, kind: "embedded" }] });
    const a = await signInWithPrivy(db, fake(v), TOKEN);
    const changed = { ...v, wallets: [{ address: wallet(), kind: "external" as const }] };
    const b = await signInWithPrivy(db, fake(changed), TOKEN);
    expect(b.id).toBe(a.id);
    expect(b.wallet).toBe(first);
    const c = await signInWithPrivy(db, fake({ ...v, wallets: [] }), TOKEN);
    expect(c.wallet).toBe(first);
  });

  it("refuses a wallet that already belongs to another account, and does not merge", async () => {
    const shared = wallet();
    const first = await signInWithPrivy(db, fake(view({ wallets: [{ address: shared, kind: "external" }] })), TOKEN);
    const second = view({ wallets: [{ address: shared, kind: "external" }] });
    await expect(signInWithPrivy(db, fake(second), TOKEN)).rejects.toMatchObject({ status: 409 });
    expect((await rows()).filter((u) => u.wallet === shared).map((u) => u.id)).toEqual([first.id]);
  });

  it("does not use an email to find or merge accounts, and does not copy one that another account holds", async () => {
    const one = await signInWithPrivy(db, fake(view({ email: "same@example.test", wallets: [{ address: wallet(), kind: "embedded" }] })), TOKEN);
    const twoView = view({ email: "same@example.test", wallets: [{ address: wallet(), kind: "embedded" }] });
    const two = await signInWithPrivy(db, fake(twoView), TOKEN);
    expect(two.id).not.toBe(one.id);
    expect(two.email).toBeNull();
    expect(one.email).toBe("same@example.test");
  });

  it("follows a verified email change on the same account", async () => {
    const v = view({ email: "old@example.test", wallets: [{ address: wallet(), kind: "embedded" }] });
    const a = await signInWithPrivy(db, fake(v), TOKEN);
    const b = await signInWithPrivy(db, fake({ ...v, email: "new@example.test" }), TOKEN);
    expect(b.id).toBe(a.id);
    expect((await db.select().from(users).where(eq(users.id, a.id)))[0]!.email).toBe("new@example.test");
  });
});

describe("reading Privy's user record", () => {
  it("takes only a verified email and Ethereum wallets, lowercased", () => {
    const seen = viewUser({
      id: "did:privy:x",
      linked_accounts: [
        { type: "email", address: "Ana@Example.test", verified_at: 1 },
        { type: "wallet", chain_type: "ethereum", address: "0xABCDEF0000000000000000000000000000000001", connector_type: "embedded" },
        { type: "wallet", chain_type: "ethereum", address: "0xABCDEF0000000000000000000000000000000002", connector_type: "injected" },
        { type: "wallet", chain_type: "solana", address: "SoLaNa" },
        { type: "phone", number: "+1" },
      ],
    });
    expect(seen).toEqual({
      id: "did:privy:x",
      email: "ana@example.test",
      wallets: [
        { address: "0xabcdef0000000000000000000000000000000001", kind: "embedded" },
        { address: "0xabcdef0000000000000000000000000000000002", kind: "external" },
      ],
    });
  });

  it("ignores an email Privy has not verified", () => {
    expect(viewUser({ id: "did:privy:y", linked_accounts: [{ type: "email", address: "a@b.test", verified_at: null }] }).email).toBeNull();
  });
});
