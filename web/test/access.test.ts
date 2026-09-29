import { beforeAll, describe, expect, it } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { businesses, createTestDb, members, seals } from "@symbolon/db";
import { requireMember, requireSeal, spacesFor } from "@/lib/server/access";
import { AuthError } from "@/lib/server/errors";
import { walletUser as upsertWalletUser } from "./helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
const chainId = arcTestnet.id;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const forbidden = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  expect((e as AuthError).status).toBe(403);
};

describe("spaces and roles", () => {
  it("lists a person's businesses on this chain with their role, and their current Seal", async () => {
    const u = await upsertWalletUser(db, addr(201));
    const [acme] = await db.insert(businesses).values({ name: "Acme", chainId }).returning();
    const [zed] = await db.insert(businesses).values({ name: "Zed", chainId }).returning();
    const [elsewhere] = await db.insert(businesses).values({ name: "Other chain", chainId: 1 }).returning();
    await db.insert(members).values([
      { businessId: acme!.id, userId: u.id, role: "owner" },
      { businessId: zed!.id, userId: u.id, role: "viewer" },
      { businessId: elsewhere!.id, userId: u.id, role: "owner" },
    ]);
    await db.insert(seals).values([
      { address: addr(301), userId: u.id, handle: "old-seal", displayName: "Old", rotatedTo: addr(302) },
      { address: addr(302), userId: u.id, handle: "studio-x", displayName: "Studio X" },
    ]);
    const s = await spacesFor(db, u.id, chainId);
    expect(s.businesses.map((b) => [b.name, b.role])).toEqual([["Acme", "owner"], ["Zed", "viewer"]]);
    expect(s.seal).toEqual({ address: addr(302), handle: "studio-x", displayName: "Studio X" });
  });

  it("is empty for someone who belongs to nothing", async () => {
    const u = await upsertWalletUser(db, addr(202));
    expect(await spacesFor(db, u.id, chainId)).toEqual({ seal: null, businesses: [] });
  });

  it("checks the role on the server: each role passes only where it is allowed", async () => {
    const [biz] = await db.insert(businesses).values({ name: "Roles Inc", chainId }).returning();
    const roles = ["owner", "approver", "requester", "viewer"] as const;
    const ids: Record<string, string> = {};
    for (const [i, role] of roles.entries()) {
      const u = await upsertWalletUser(db, addr(210 + i));
      ids[role] = u.id;
      await db.insert(members).values({ businessId: biz!.id, userId: u.id, role });
    }
    for (const role of roles) {
      expect((await requireMember(db, ids[role]!, biz!.id)).role).toBe(role); // any member
      expect((await requireMember(db, ids[role]!, biz!.id, role)).role).toBe(role);
    }
    await forbidden(requireMember(db, ids.viewer!, biz!.id, "owner", "approver"));
    await forbidden(requireMember(db, ids.requester!, biz!.id, "owner", "approver"));
    await forbidden(requireMember(db, ids.approver!, biz!.id, "owner"));
    expect((await requireMember(db, ids.approver!, biz!.id, "owner", "approver")).role).toBe("approver");
  });

  it("refuses a non-member, and a member of a different business, with the same answer", async () => {
    const [mine] = await db.insert(businesses).values({ name: "Mine", chainId }).returning();
    const [theirs] = await db.insert(businesses).values({ name: "Theirs", chainId }).returning();
    const u = await upsertWalletUser(db, addr(220));
    await db.insert(members).values({ businessId: mine!.id, userId: u.id, role: "owner" });
    await forbidden(requireMember(db, u.id, theirs!.id));
    await forbidden(requireMember(db, u.id, "00000000-0000-0000-0000-000000000000"));
  });

  it("requires a Seal for vendor actions", async () => {
    const none = await upsertWalletUser(db, addr(230));
    await forbidden(requireSeal(db, none.id));
    const some = await upsertWalletUser(db, addr(231));
    await db.insert(seals).values({ address: addr(303), userId: some.id, handle: "has-seal", displayName: "Has Seal" });
    expect((await requireSeal(db, some.id)).handle).toBe("has-seal");
  });
});
