import "server-only";

import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { businesses, members, users, type Database } from "@symbolon/db";
import { and, eq } from "drizzle-orm";
import { getAddress, type Hex, type PublicClient } from "viem";

import { requireMember, type Role } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import { prepareChange, recordChange, type PreparedChangeResult } from "./queued-change";
import type { SessionUser } from "./session";

const OPERATING_BUDGET: Hex = `0x${"00".repeat(32)}`;

export interface TeamMemberView {
  userId: string;
  email: string | null;
  wallet: string | null;
  appRole: Role;
  budgets: string[];
  createdAt: Date;
  onchainRole: "owner" | "approver_all" | "approver_scoped" | "requester" | "none" | "unknown";
  onchainMismatch: boolean;
  mismatchReason?: string;
}

export interface TeamViewData {
  business: {
    id: string;
    name: string;
    vault: string | null;
    chainId: number;
  };
  currentUserRole: Role;
  isVaultOwner: boolean;
  members: TeamMemberView[];
}

/**
 * Loads team members with both their app role and verified onchain role from VaultLens (plan 05t, Q10).
 */
export async function listTeamMembers(
  db: Database,
  client: PublicClient | undefined,
  deployment: Deployment | undefined,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
): Promise<TeamViewData> {
  const { role: currentUserRole } = await requireMember(db, user.id, businessId);

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      vault: businesses.vault,
      chainId: businesses.chainId,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    throw new AuthError(404, "Business not found.");
  }

  const rawMembers = await db
    .select({
      userId: members.userId,
      role: members.role,
      budgets: members.budgets,
      createdAt: members.createdAt,
      email: users.email,
      wallet: users.wallet,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.businessId, businessId))
    .orderBy(members.createdAt);

  let vaultOwner: string | null = null;
  let contracts: ReturnType<typeof symbolonContracts> | null = null;

  if (business.vault && client && deployment) {
    try {
      contracts = symbolonContracts(client, deployment);
      const state = await contracts.lens.read.getVaultState([getAddress(business.vault)]);
      vaultOwner = getAddress(state.owner);
    } catch {
      // RPC transient error; onchain roles will show "unknown"
    }
  }

  const isVaultOwner = Boolean(
    user.wallet && vaultOwner && getAddress(user.wallet) === getAddress(vaultOwner),
  );

  const memberViews: TeamMemberView[] = await Promise.all(
    rawMembers.map(async (m): Promise<TeamMemberView> => {
      let onchainRole: TeamMemberView["onchainRole"] = "none";
      let onchainMismatch = false;
      let mismatchReason: string | undefined;

      const memberWallet = m.wallet ? getAddress(m.wallet) : null;

      if (!business.vault) {
        onchainRole = "unknown";
      } else if (!memberWallet || !contracts) {
        onchainRole = "unknown";
      } else if (vaultOwner && memberWallet === vaultOwner) {
        onchainRole = "owner";
      } else {
        try {
          const vaultAddr = getAddress(business.vault);
          const [isAllApprover, isReq] = await Promise.all([
            contracts.lens.read.isApprover([vaultAddr, memberWallet, OPERATING_BUDGET]),
            contracts.lens.read.isRequester([vaultAddr, memberWallet]),
          ]);

          if (isAllApprover) {
            onchainRole = "approver_all";
          } else if (m.budgets && m.budgets.length > 0) {
            const scopedChecks = await Promise.all(
              m.budgets.map((b) =>
                contracts!.lens.read.isApprover([vaultAddr, memberWallet, b as Hex]).catch(() => false),
              ),
            );
            if (scopedChecks.some(Boolean)) {
              onchainRole = "approver_scoped";
            } else if (isReq) {
              onchainRole = "requester";
            }
          } else if (isReq) {
            onchainRole = "requester";
          }
        } catch {
          onchainRole = "unknown";
        }
      }

      // Check for discrepancies between app role and onchain role
      if (m.role === "approver") {
        if (onchainRole !== "owner" && onchainRole !== "approver_all" && onchainRole !== "approver_scoped") {
          onchainMismatch = true;
          mismatchReason =
            "Approver in app but not on Vault. Approvals and payments from this wallet will be refused until the owner sets the onchain role.";
        }
      } else if (m.role === "requester") {
        if (onchainRole !== "owner" && onchainRole !== "requester") {
          onchainMismatch = true;
          mismatchReason =
            "Requester in app but not on Vault. Delivery actions from this wallet will be refused until the owner sets the onchain role.";
        }
      }

      return {
        userId: m.userId,
        email: m.email,
        wallet: m.wallet,
        appRole: m.role,
        budgets: m.budgets ?? [],
        createdAt: m.createdAt,
        onchainRole,
        onchainMismatch,
        mismatchReason,
      };
    }),
  );

  return {
    business,
    currentUserRole,
    isVaultOwner,
    members: memberViews,
  };
}

/**
 * Changes a member's app role and budgets (plan 05t, Q10, Q11).
 * The owner cannot be demoted.
 * If the member currently holds an onchain role, the owner must revoke that onchain role first.
 */
export async function setMemberRole(
  db: Database,
  client: PublicClient | undefined,
  deployment: Deployment | undefined,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  targetUserId: string,
  newRole: Role,
  budgets?: string[],
) {
  await requireMember(db, user.id, businessId, "owner");

  const [targetMember] = await db
    .select({
      role: members.role,
      budgets: members.budgets,
      wallet: users.wallet,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.businessId, businessId), eq(members.userId, targetUserId)))
    .limit(1);

  if (!targetMember) {
    throw new AuthError(404, "Member not found.");
  }

  if (targetMember.role === "owner" || newRole === "owner") {
    throw new AuthError(400, "The owner's role cannot be changed or transferred.");
  }

  const [business] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  // If changing role and target currently has onchain rights, ensure onchain role is revoked first
  if (business?.vault && client && deployment && targetMember.wallet) {
    const contracts = symbolonContracts(client, deployment);
    const vaultAddr = getAddress(business.vault);
    const targetWallet = getAddress(targetMember.wallet);

    const [isAppr, isReq] = await Promise.all([
      contracts.lens.read.isApprover([vaultAddr, targetWallet, OPERATING_BUDGET]).catch(() => false),
      contracts.lens.read.isRequester([vaultAddr, targetWallet]).catch(() => false),
    ]);

    if ((targetMember.role === "approver" && isAppr && newRole !== "approver") ||
        (targetMember.role === "requester" && isReq && newRole !== "requester")) {
      throw new AuthError(
        409,
        "Revoke this member's onchain role first before changing their app role.",
      );
    }
  }

  const cleanBudgets: string[] = [];
  if (budgets && Array.isArray(budgets)) {
    for (const b of budgets) {
      if (typeof b === "string" && /^0x[0-9a-fA-F]{64}$/.test(b)) {
        cleanBudgets.push(b.toLowerCase());
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(members)
      .set({
        role: newRole,
        budgets: cleanBudgets,
      })
      .where(and(eq(members.businessId, businessId), eq(members.userId, targetUserId)));

    await appendAppDecision(tx, businessId, {
      kind: "member_role_changed",
      subject: targetUserId,
      actor: user.id,
      inputs: {
        previousRole: targetMember.role,
        newRole,
        budgets: cleanBudgets,
      },
      rule: "owner updated team member role in app",
      outcome: "role_updated",
    });
  });

  return { success: true };
}

/**
 * Removes a member from the business (plan 05t, Q11).
 * The owner cannot be removed.
 * If the member holds an onchain role, it must be revoked onchain first.
 */
export async function removeMember(
  db: Database,
  client: PublicClient | undefined,
  deployment: Deployment | undefined,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  targetUserId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const [targetMember] = await db
    .select({
      role: members.role,
      wallet: users.wallet,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.businessId, businessId), eq(members.userId, targetUserId)))
    .limit(1);

  if (!targetMember) {
    throw new AuthError(404, "Member not found.");
  }

  if (targetMember.role === "owner") {
    throw new AuthError(400, "The business owner cannot be removed.");
  }

  const [business] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  // Check onchain role: if onchain role exists, refuse until revoked
  if (business?.vault && client && deployment && targetMember.wallet) {
    const contracts = symbolonContracts(client, deployment);
    const vaultAddr = getAddress(business.vault);
    const targetWallet = getAddress(targetMember.wallet);

    const [isAppr, isReq] = await Promise.all([
      contracts.lens.read.isApprover([vaultAddr, targetWallet, OPERATING_BUDGET]).catch(() => false),
      contracts.lens.read.isRequester([vaultAddr, targetWallet]).catch(() => false),
    ]);

    if (isAppr || isReq) {
      throw new AuthError(
        409,
        "This member holds an onchain role on the Vault. Revoke their role onchain before removing them from the team.",
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(members)
      .where(and(eq(members.businessId, businessId), eq(members.userId, targetUserId)));

    await appendAppDecision(tx, businessId, {
      kind: "member_removed",
      subject: targetUserId,
      actor: user.id,
      inputs: {
        role: targetMember.role,
        wallet: targetMember.wallet,
      },
      rule: "owner removed member from team",
      outcome: "removed",
    });
  });

  return { success: true };
}

/**
 * Prepares an onchain role transaction (setApprover or setRequester)
 * using the QueuedChange infrastructure (plan 05t, Q10).
 */
export async function prepareOnchainRole(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  input: {
    targetUserId: string;
    role: "approver" | "requester";
    enabled: boolean;
    budgetId?: string;
  },
): Promise<PreparedChangeResult> {
  await requireMember(db, user.id, businessId, "owner");

  const [targetUser] = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.id, input.targetUserId))
    .limit(1);

  if (!targetUser || !targetUser.wallet) {
    throw new AuthError(400, "Target member does not have a wallet registered.");
  }

  const targetAddress = getAddress(targetUser.wallet);

  if (input.role === "approver") {
    const budgetId = (input.budgetId && /^0x[0-9a-fA-F]{64}$/.test(input.budgetId))
      ? (input.budgetId.toLowerCase() as Hex)
      : OPERATING_BUDGET;

    return await prepareChange(db, client, deployment, user, businessId, {
      kind: "set_approver",
      args: [targetAddress, budgetId, input.enabled],
    });
  } else if (input.role === "requester") {
    return await prepareChange(db, client, deployment, user, businessId, {
      kind: "set_requester",
      args: [targetAddress, input.enabled],
    });
  }

  throw new AuthError(400, "Unsupported onchain role kind.");
}

/**
 * Records an onchain role change transaction from receipt (plan 05t, Q10).
 */
export async function recordOnchainRole(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  txHash: Hex,
) {
  return await recordChange(db, client, deployment, user, businessId, txHash);
}
