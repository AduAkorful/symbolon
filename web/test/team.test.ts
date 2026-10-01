import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  members,
  users,
} from "@symbolon/db";
import { eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import {
  listTeamMembers,
  prepareOnchainRole,
  removeMember,
  setMemberRole,
} from "@/lib/server/team";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const deployment = getDeployment(arcTestnet.id);
let userNo = 4000;
let vaultNo = 800;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `team-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [approverMember] = await db
    .insert(users)
    .values({
      email: `team-appr-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewerMember] = await db
    .insert(users)
    .values({
      email: `team-view-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [outsider] = await db
    .insert(users)
    .values({
      email: `team-out-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vaultAddr = address(++vaultNo);

  const [business] = await db
    .insert(businesses)
    .values({
      name: "Team Test Business",
      chainId: arcTestnet.id,
      vault: vaultAddr,
      vaultBlock: 100n,
    })
    .returning();

  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: approverMember!.id, role: "approver" },
    { businessId: business!.id, userId: viewerMember!.id, role: "viewer" },
  ]);

  return {
    owner: owner!,
    approverMember: approverMember!,
    viewerMember: viewerMember!,
    outsider: outsider!,
    business: business!,
    vaultAddr,
  };
}

describe("Team management service (05t Part B)", () => {
  it("listTeamMembers: member can list, detects onchain role mismatch (Q10)", async () => {
    const { owner, approverMember, outsider, business, vaultAddr } = await fixture();

    // Mock lens: approverMember is not onchain yet
    const mockContracts: any = {
      lens: {
        read: {
          getVaultState: async () => ({ owner: owner.wallet }),
          isApprover: async () => false,
          approverBudgetCount: async () => 0n,
          isRequester: async () => false,
        },
      },
    };

    // Outsider gets 403
    await expect(
      listTeamMembers(db, undefined, undefined, outsider, business.id),
    ).rejects.toMatchObject({ status: 403 });

    // Client/deployment stubbed
    const stubClient: any = {};
    vi.spyOn(await import("@symbolon/chain"), "symbolonContracts").mockReturnValue(mockContracts);

    const team = await listTeamMembers(db, stubClient, deployment, owner, business.id);
    expect(team.business.name).toBe("Team Test Business");
    expect(team.isVaultOwner).toBe(true);
    expect(team.members.length).toBe(3);

    // Check approverMember mismatch
    const apprView = team.members.find((m) => m.userId === approverMember.id);
    expect(apprView).toBeDefined();
    expect(apprView!.appRole).toBe("approver");
    expect(apprView!.onchainRole).toBe("none");
    expect(apprView!.onchainMismatch).toBe(true);
    expect(apprView!.mismatchReason).toContain("Approver in app but not on Vault");
  });

  it("setMemberRole: owner can change role, owner cannot be demoted, active onchain role blocks change (Q11)", async () => {
    const { owner, approverMember, viewerMember, business } = await fixture();

    const stubClient: any = {};

    // Cannot demote owner
    await expect(
      setMemberRole(db, stubClient, deployment, owner, business.id, owner.id, "viewer"),
    ).rejects.toMatchObject({ status: 400 });

    // If target member has active onchain approver role, changing app role to viewer throws 409
    const mockContractsWithApprover: any = {
      lens: {
        read: {
          getVaultState: async () => ({ owner: owner.wallet }),
          approverBudgetCount: async () => 1n,
          isApprover: async () => true, // active onchain!
          isRequester: async () => false,
        },
      },
    };
    vi.spyOn(await import("@symbolon/chain"), "symbolonContracts").mockReturnValue(mockContractsWithApprover);

    await expect(
      setMemberRole(db, stubClient, deployment, owner, business.id, approverMember.id, "viewer"),
    ).rejects.toMatchObject({ status: 409 });

    // Viewer (no onchain role) can be changed to requester
    const mockContractsClean: any = {
      lens: {
        read: {
          getVaultState: async () => ({ owner: owner.wallet }),
          isApprover: async () => false,
          approverBudgetCount: async () => 0n,
          isRequester: async () => false,
        },
      },
    };
    vi.spyOn(await import("@symbolon/chain"), "symbolonContracts").mockReturnValue(mockContractsClean);

    await setMemberRole(db, stubClient, deployment, owner, business.id, viewerMember.id, "requester");

    const [updated] = await db
      .select()
      .from(members)
      .where(eq(members.userId, viewerMember.id));
    expect(updated!.role).toBe("requester");
  });

  it("removeMember: owner cannot be removed, member with onchain role cannot be removed without revoking first (Q11)", async () => {
    const { owner, approverMember, viewerMember, business } = await fixture();

    const stubClient: any = {};

    // Cannot remove owner
    await expect(
      removeMember(db, stubClient, deployment, owner, business.id, owner.id),
    ).rejects.toMatchObject({ status: 400 });

    // Approver with onchain role cannot be removed
    const mockContractsWithApprover: any = {
      lens: {
        read: {
          getVaultState: async () => ({ owner: owner.wallet }),
          approverBudgetCount: async () => 1n,
          isApprover: async () => true,
          isRequester: async () => false,
        },
      },
    };
    vi.spyOn(await import("@symbolon/chain"), "symbolonContracts").mockReturnValue(mockContractsWithApprover);

    await expect(
      removeMember(db, stubClient, deployment, owner, business.id, approverMember.id),
    ).rejects.toMatchObject({ status: 409 });

    // Member with no onchain role can be removed cleanly
    const mockContractsClean: any = {
      lens: {
        read: {
          getVaultState: async () => ({ owner: owner.wallet }),
          isApprover: async () => false,
          approverBudgetCount: async () => 0n,
          isRequester: async () => false,
        },
      },
    };
    vi.spyOn(await import("@symbolon/chain"), "symbolonContracts").mockReturnValue(mockContractsClean);

    await removeMember(db, stubClient, deployment, owner, business.id, viewerMember.id);

    const [removed] = await db
      .select()
      .from(members)
      .where(eq(members.userId, viewerMember.id));
    expect(removed).toBeUndefined();

    // Decision logged
    const logged = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, business.id));
    expect(logged.some((d) => d.kind === "member_removed")).toBe(true);
  });
});
