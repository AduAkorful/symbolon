import { and, desc, eq, isNull } from "drizzle-orm";
import { businesses, members, seals, type Database } from "@symbolon/db";
import { AuthError } from "./errors";

// Plan 05g, S7: who a person is here and what they may do is decided on the server, on every action. Hiding a button is not a check.
export type Role = (typeof members.$inferSelect)["role"];

export interface Spaces {
  /** The person's current Seal (the newest one not replaced by a rotation), if they have one */
  seal: { address: string; handle: string; displayName: string } | null;
  businesses: { id: string; name: string; role: Role; vault: string | null; stewardWallet: string | null; stewardMode: string }[];
}

async function currentSeal(db: Database, userId: string): Promise<Spaces["seal"]> {
  const [seal] = await db
    .select({ address: seals.address, handle: seals.handle, displayName: seals.displayName })
    .from(seals)
    .where(and(eq(seals.userId, userId), isNull(seals.rotatedTo)))
    .orderBy(desc(seals.createdAt))
    .limit(1);
  return seal ?? null;
}

/** Everything a person belongs to on this chain: their Seal and each business they're a member of */
export async function spacesFor(db: Database, userId: string, chainId: number): Promise<Spaces> {
  const rows = await db
    .select({ id: businesses.id, name: businesses.name, role: members.role, vault: businesses.vault, stewardWallet: businesses.stewardWallet, stewardMode: businesses.stewardMode })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(and(eq(members.userId, userId), eq(businesses.chainId, chainId)))
    .orderBy(businesses.name);
  return { seal: await currentSeal(db, userId), businesses: rows };
}

/**
 * The person's role in a business, if it is one of `allowed` (any member when none are named).
 * A non-member and a member without the role both get the same 403, so this doesn't reveal which businesses exist.
 */
export async function requireMember(db: Database, userId: string, businessId: string, ...allowed: Role[]): Promise<{ role: Role }> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.userId, userId), eq(members.businessId, businessId)))
    .limit(1);
  if (!row || (allowed.length > 0 && !allowed.includes(row.role))) throw new AuthError(403, "You don't have access to do this for this business.");
  return { role: row.role };
}

/** The person's current Seal, or a 403 for someone who hasn't registered one */
export async function requireSeal(db: Database, userId: string): Promise<NonNullable<Spaces["seal"]>> {
  const seal = await currentSeal(db, userId);
  if (!seal) throw new AuthError(403, "You haven't registered a Seal yet.");
  return seal;
}
