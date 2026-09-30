import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { isAddress } from "viem";
import { businesses, members, seals, sessions, users, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import { UNSAFE_TEXT } from "../text-safety";

export interface ProfileData {
  user: {
    id: string;
    email: string | null;
    wallet: string | null;
    displayName: string | null;
    createdAt: string;
  };
  sessions: {
    id: string;
    createdAt: string;
    lastSeenAt: string;
    isCurrent: boolean;
  }[];
  accounts: {
    businesses: {
      id: string;
      name: string;
      role: string;
      vault: string | null;
    }[];
    seal: {
      address: string;
      handle: string;
      displayName: string;
    } | null;
  };
}

/**
 * Loads a user's cross-account profile facts (plan 05u N8).
 */
export async function getProfile(
  db: Database,
  userId: string,
  currentSessionId?: string,
): Promise<ProfileData> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AuthError(404, "User not found.");

  const now = new Date();
  const activeSessions = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.lastSeenAt));

  const userBusinesses = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      role: members.role,
      vault: businesses.vault,
    })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(eq(members.userId, userId))
    .orderBy(businesses.name);

  const [seal] = await db
    .select({
      address: seals.address,
      handle: seals.handle,
      displayName: seals.displayName,
    })
    .from(seals)
    .where(and(eq(seals.userId, userId), isNull(seals.rotatedTo)))
    .orderBy(desc(seals.createdAt))
    .limit(1);

  return {
    user: {
      id: user.id,
      email: user.email,
      wallet: user.wallet,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString(),
    },
    sessions: activeSessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      isCurrent: s.id === currentSessionId,
    })),
    accounts: {
      businesses: userBusinesses,
      seal: seal ?? null,
    },
  };
}

/**
 * Updates a user's display name (plan 05u N7).
 * - 1..80 characters, NFC normalized, trimmed
 * - Refuses control or bidirectional override characters
 * - Refuses names matching an EVM address or another person's email/wallet
 */
export async function updateDisplayName(
  db: Database,
  userId: string,
  rawName: string,
): Promise<{ ok: boolean; displayName: string }> {
  if (typeof rawName !== "string") throw new AuthError(400, "Display name must be a string.");

  const name = rawName.trim().normalize("NFC");
  if (name.length < 1 || name.length > 80) {
    throw new AuthError(400, "Display name must be between 1 and 80 characters.");
  }

  if (UNSAFE_TEXT.test(name)) {
    throw new AuthError(400, "Display name contains disallowed control or formatting characters.");
  }

  // Refuse if name looks like an EVM address
  if (isAddress(name, { strict: false })) {
    throw new AuthError(400, "Display name cannot be an address.");
  }

  // Refuse if name matches another person's verified email
  const lowerName = name.toLowerCase();
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, lowerName))
    .limit(1);

  if (existingUser && existingUser.id !== userId) {
    throw new AuthError(400, "Display name cannot match another person's email.");
  }

  await db.update(users).set({ displayName: name }).where(eq(users.id, userId));

  return { ok: true, displayName: name };
}
