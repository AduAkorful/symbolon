import { eq } from "drizzle-orm";
import { users, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

// Plan 05g, S4–S5: one person per wallet, per Circle user, per email. Sign-in never merges two accounts on a matching string.

const lower = (s: string) => s.toLowerCase();

export async function upsertWalletUser(db: Database, wallet: string): Promise<SessionUser> {
  const address = lower(wallet);
  const [found] = await db.select().from(users).where(eq(users.wallet, address)).limit(1);
  if (found) return found;
  // two first sign-ins racing on one address: the unique index lets one win, the other reads it back
  const [made] = await db.insert(users).values({ wallet: address }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(users).where(eq(users.wallet, address)).limit(1);
  if (!again) throw new AuthError(409, "Couldn't create the account. Try again.");
  return again;
}

/**
 * Signs in a Circle user. A known Circle id gets its own user, and its stored email wins over anything the caller passes.
 * A new Circle id becomes a new user with the email the *server* asked Circle to verify; if that email or wallet already
 * belongs to someone else it is refused rather than merged.
 */
export async function upsertCircleUser(db: Database, a: { circleUserId: string; email: string; wallet: string }): Promise<SessionUser> {
  const wallet = lower(a.wallet);
  const email = lower(a.email);
  const [known] = await db.select().from(users).where(eq(users.circleUserId, a.circleUserId)).limit(1);
  if (known) {
    if (known.wallet && known.wallet !== wallet) throw new AuthError(409, "This sign-in's wallet doesn't match the one on the account. Nothing was changed.");
    if (!known.wallet) {
      const [owner] = await db.select().from(users).where(eq(users.wallet, wallet)).limit(1);
      if (owner) throw new AuthError(409, "That wallet already belongs to another account.");
      const [set] = await db.update(users).set({ wallet }).where(eq(users.id, known.id)).returning();
      return set!;
    }
    return known;
  }
  const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (byEmail) throw new AuthError(409, "An account with this email already exists. Sign in the way you did before.");
  const [byWallet] = await db.select().from(users).where(eq(users.wallet, wallet)).limit(1);
  if (byWallet) throw new AuthError(409, "That wallet already belongs to another account.");
  const [made] = await db.insert(users).values({ email, wallet, circleUserId: a.circleUserId }).returning();
  return made!;
}

/** Development only (plan 05g, S6): a named local test user, by a reserved .test address. No wallet. */
export async function upsertDevUser(db: Database, email: string): Promise<SessionUser> {
  const address = lower(email);
  const [found] = await db.select().from(users).where(eq(users.email, address)).limit(1);
  if (found) return found;
  const [made] = await db.insert(users).values({ email: address }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await db.select().from(users).where(eq(users.email, address)).limit(1);
  return again!;
}
