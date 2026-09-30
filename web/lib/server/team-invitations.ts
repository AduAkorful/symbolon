import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { businesses, members, teamInvitations, users, type Database } from "@symbolon/db";
import { requireMember, type Role } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const cleanLabel = (value: unknown): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AuthError(400, "Label must be a string.");
  const result = value.normalize("NFC").trim();
  if (result.length > 100 || /[\p{Cc}\p{Cf}]/u.test(result)) {
    throw new AuthError(400, "Label must be 1 to 100 characters, without control characters.");
  }
  return result || null;
};

const VALID_INVITE_ROLES: Role[] = ["approver", "requester", "viewer"];

/**
 * Creates a 14-day team invite link (plan 05t, Q9).
 * The raw token is returned once to the caller and only its SHA-256 is stored.
 */
export async function createTeamInvitation(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  input: { role: unknown; budgets?: unknown; label?: unknown },
  origin: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const role = input.role as Role;
  if (!VALID_INVITE_ROLES.includes(role)) {
    throw new AuthError(400, "Team members can only be invited as approver, requester, or viewer.");
  }

  let budgets: string[] = [];
  if (input.budgets !== undefined && input.budgets !== null) {
    if (!Array.isArray(input.budgets)) {
      throw new AuthError(400, "Budgets must be an array of budget IDs.");
    }
    for (const b of input.budgets) {
      if (typeof b !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b)) {
        throw new AuthError(400, "Each budget ID must be a 32-byte hex hash.");
      }
      budgets.push(b.toLowerCase());
    }
  }

  const label = cleanLabel(input.label);

  const [business] = await db
    .select({ name: businesses.name, vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) throw new AuthError(404, "That business doesn't exist.");
  if (!business.vault) throw new AuthError(409, "Create this business's Vault before inviting team members.");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const row = await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(teamInvitations)
      .values({
        businessId,
        role,
        budgets,
        label,
        tokenHash,
        createdBy: user.id,
        expiresAt,
      })
      .returning();

    await appendAppDecision(tx, businessId, {
      kind: "team_invitation_created",
      subject: inv!.id,
      actor: user.id,
      inputs: { role, budgets, label },
      rule: "owner created team invitation secret link",
      outcome: "invited",
    });

    return inv!;
  });

  return {
    id: row.id,
    token,
    role: row.role,
    budgets: row.budgets,
    label: row.label,
    expiresAt: row.expiresAt,
    inviteUrl: `${origin.replace(/\/$/, "")}/join/${token}`,
  };
}

/** Lists active pending invitations for a business */
export async function listTeamInvitations(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
) {
  await requireMember(db, user.id, businessId);

  const now = new Date();
  const rows = await db
    .select({
      id: teamInvitations.id,
      role: teamInvitations.role,
      budgets: teamInvitations.budgets,
      label: teamInvitations.label,
      createdAt: teamInvitations.createdAt,
      expiresAt: teamInvitations.expiresAt,
    })
    .from(teamInvitations)
    .where(
      and(
        eq(teamInvitations.businessId, businessId),
        isNull(teamInvitations.revokedAt),
        isNull(teamInvitations.acceptedAt),
        gt(teamInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(teamInvitations.createdAt));

  return rows;
}

/** Revokes an unaccepted invitation */
export async function revokeTeamInvitation(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  invitationId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const [row] = await db
    .select()
    .from(teamInvitations)
    .where(
      and(
        eq(teamInvitations.id, invitationId),
        eq(teamInvitations.businessId, businessId),
        isNull(teamInvitations.revokedAt),
        isNull(teamInvitations.acceptedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new AuthError(404, "Invitation not found or already closed.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(teamInvitations)
      .set({ revokedAt: new Date() })
      .where(eq(teamInvitations.id, invitationId));

    await appendAppDecision(tx, businessId, {
      kind: "team_invitation_revoked",
      subject: invitationId,
      actor: user.id,
      inputs: { role: row.role, label: row.label },
      rule: "owner revoked team invitation",
      outcome: "revoked",
    });
  });

  return { success: true };
}

/**
 * Public bearer check: load invitation details for the /join/[token] screen.
 * Expired, revoked, or already accepted tokens deliberately share a generic 404 response.
 */
export async function getInvitationByToken(db: Database, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    throw new AuthError(404, "This invitation can't be used.");
  }

  const tokenHash = sha(token);
  const [row] = await db
    .select({
      id: teamInvitations.id,
      businessId: teamInvitations.businessId,
      businessName: businesses.name,
      role: teamInvitations.role,
      budgets: teamInvitations.budgets,
      expiresAt: teamInvitations.expiresAt,
      acceptedAt: teamInvitations.acceptedAt,
      revokedAt: teamInvitations.revokedAt,
    })
    .from(teamInvitations)
    .innerJoin(businesses, eq(businesses.id, teamInvitations.businessId))
    .where(eq(teamInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!row || row.expiresAt <= new Date() || row.acceptedAt || row.revokedAt) {
    throw new AuthError(404, "This invitation can't be used.");
  }

  return {
    id: row.id,
    businessId: row.businessId,
    businessName: row.businessName,
    role: row.role,
    budgets: row.budgets,
    expiresAt: row.expiresAt,
  };
}

/**
 * Accepts an invitation.
 * Requires signed-in user with a connected or embedded wallet (Decision Q9).
 */
export async function acceptTeamInvitation(
  db: Database,
  user: Pick<SessionUser, "id" | "wallet">,
  token: unknown,
) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    throw new AuthError(404, "This invitation can't be used.");
  }

  if (!user.wallet) {
    throw new AuthError(
      400,
      "A wallet is required to join a team. Please link or create a wallet before accepting.",
    );
  }

  const tokenHash = sha(token);
  const now = new Date();

  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.tokenHash, tokenHash),
          gt(teamInvitations.expiresAt, now),
          isNull(teamInvitations.acceptedAt),
          isNull(teamInvitations.revokedAt),
        ),
      )
      .limit(1);

    if (!inv) {
      throw new AuthError(404, "This invitation can't be used.");
    }

    // Check if already a member
    const [existingMember] = await tx
      .select({ role: members.role })
      .from(members)
      .where(and(eq(members.businessId, inv.businessId), eq(members.userId, user.id)))
      .limit(1);

    if (existingMember) {
      throw new AuthError(409, "You are already a member of this business.");
    }

    // Mark invitation accepted
    await tx
      .update(teamInvitations)
      .set({
        acceptedBy: user.id,
        acceptedAt: now,
      })
      .where(eq(teamInvitations.id, inv.id));

    // Insert membership
    await tx.insert(members).values({
      businessId: inv.businessId,
      userId: user.id,
      role: inv.role,
      budgets: inv.budgets,
    });

    // Record decision
    await appendAppDecision(tx, inv.businessId, {
      kind: "team_invitation_accepted",
      subject: inv.id,
      actor: user.id,
      inputs: { role: inv.role, budgets: inv.budgets, wallet: user.wallet },
      rule: "invitee accepted team invitation secret link",
      outcome: "member_added",
    });

    return {
      businessId: inv.businessId,
      role: inv.role,
    };
  });
}
