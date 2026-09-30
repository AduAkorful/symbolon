import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arcTestnet } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  members,
  teamInvitations,
  users,
} from "@symbolon/db";
import { eq } from "drizzle-orm";
import {
  acceptTeamInvitation,
  createTeamInvitation,
  getInvitationByToken,
  listTeamInvitations,
  revokeTeamInvitation,
} from "@/lib/server/team-invitations";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
let userNo = 3000;
let vaultNo = 700;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [member] = await db
    .insert(users)
    .values({
      email: `member-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [inviteeWithWallet] = await db
    .insert(users)
    .values({
      email: `invitee-wallet-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [inviteeNoWallet] = await db
    .insert(users)
    .values({
      email: `invitee-nowallet-${crypto.randomUUID()}@example.test`,
    })
    .returning();

  const [business] = await db
    .insert(businesses)
    .values({
      name: "Acme Team Corp",
      chainId: arcTestnet.id,
      vault: address(++vaultNo),
      vaultBlock: 100n,
    })
    .returning();

  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: member!.id, role: "approver" },
  ]);

  return { owner: owner!, member: member!, inviteeWithWallet: inviteeWithWallet!, inviteeNoWallet: inviteeNoWallet!, business: business! };
}

describe("Team invitations service (05t Part B)", () => {
  it("creates an invitation: owner only, bearer secret returned once, stored as hash (Q9)", async () => {
    const { owner, member, business } = await fixture();

    // Member cannot create invite (owner only)
    await expect(
      createTeamInvitation(db, member, business.id, { role: "approver" }, "https://symbolon.test"),
    ).rejects.toMatchObject({ status: 403 });

    // Rejects 'owner' role
    await expect(
      createTeamInvitation(db, owner, business.id, { role: "owner" as any }, "https://symbolon.test"),
    ).rejects.toMatchObject({ status: 400 });

    // Owner creates valid invite
    const created = await createTeamInvitation(
      db,
      owner,
      business.id,
      { role: "approver", label: "Finance Director" },
      "https://symbolon.test",
    );

    expect(created.token).toBeDefined();
    expect(created.inviteUrl).toContain(created.token);
    expect(created.role).toBe("approver");
    expect(created.label).toBe("Finance Director");

    // Verify DB row only stores the SHA-256 hash, not the raw token
    const [row] = await db.select().from(teamInvitations).where(eq(teamInvitations.id, created.id));
    expect(row).toBeDefined();
    expect(row!.tokenHash).not.toBe(created.token);
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lists active pending invitations and allows owner to revoke", async () => {
    const { owner, business } = await fixture();

    const inv = await createTeamInvitation(
      db,
      owner,
      business.id,
      { role: "requester", label: "Dev Lead" },
      "https://symbolon.test",
    );

    const list = await listTeamInvitations(db, owner, business.id);
    expect(list.some((i) => i.id === inv.id)).toBe(true);

    // Revoke
    await revokeTeamInvitation(db, owner, business.id, inv.id);

    // No longer in pending list
    const listAfter = await listTeamInvitations(db, owner, business.id);
    expect(listAfter.some((i) => i.id === inv.id)).toBe(false);

    // Loading revoked invite returns 404
    await expect(getInvitationByToken(db, inv.token)).rejects.toMatchObject({ status: 404 });
  });

  it("acceptTeamInvitation: requires wallet, rejects existing members, adds member and decision (Q9)", async () => {
    const { owner, member, inviteeNoWallet, inviteeWithWallet, business } = await fixture();

    const inv = await createTeamInvitation(
      db,
      owner,
      business.id,
      { role: "viewer", label: "Auditor" },
      "https://symbolon.test",
    );

    // Public lookup succeeds
    const pub = await getInvitationByToken(db, inv.token);
    expect(pub.businessName).toBe("Acme Team Corp");
    expect(pub.role).toBe("viewer");

    // Invitee without wallet is rejected with 400
    await expect(acceptTeamInvitation(db, inviteeNoWallet, inv.token)).rejects.toMatchObject({
      status: 400,
    });

    // Existing member is rejected with 409
    await expect(acceptTeamInvitation(db, member, inv.token)).rejects.toMatchObject({
      status: 409,
    });

    // Invitee with wallet accepts successfully
    const result = await acceptTeamInvitation(db, inviteeWithWallet, inv.token);
    expect(result.businessId).toBe(business.id);
    expect(result.role).toBe("viewer");

    // Member row now exists in DB
    const [newMember] = await db
      .select()
      .from(members)
      .where(eq(members.userId, inviteeWithWallet.id));
    expect(newMember).toBeDefined();
    expect(newMember!.role).toBe("viewer");

    // Decision logged
    const loggedDecisions = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, business.id));
    expect(loggedDecisions.some((d) => d.kind === "team_invitation_accepted")).toBe(true);

    // Replay/second accept attempt fails
    await expect(acceptTeamInvitation(db, inviteeWithWallet, inv.token)).rejects.toMatchObject({
      status: 404,
    });
  });
});
