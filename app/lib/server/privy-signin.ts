import { and, eq, ne } from "drizzle-orm";
import { users, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

// Plan 05k, P2–P4. The browser hands over Privy's access token and nothing else. The server checks the token, asks Privy for the user
// with the app secret, and decides who this is. An email or wallet address from the request never reaches this file.

export interface PrivyUserView {
  id: string;
  /** Lowercase, and only when Privy has verified it */
  email: string | null;
  /** Ethereum wallets on the account, lowercase. "external" = one the person already had; "embedded" = made by Privy for them. */
  wallets: { address: string; kind: "external" | "embedded" }[];
}

export interface PrivyLike {
  /** The app id this client is for */
  appId: string;
  verifyAccessToken(token: string): Promise<{ userId: string; appId: string }>;
  getUser(userId: string): Promise<PrivyUserView>;
}

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const retry = (message: string) => new AuthError(503, message);

/** The wallet a new account starts with: the one they signed in with, else the one Privy made for them */
export function chooseWallet(wallets: PrivyUserView["wallets"]): string | null {
  return (wallets.find((w) => w.kind === "external") ?? wallets[0])?.address ?? null;
}

export async function signInWithPrivy(db: Database, privy: PrivyLike, accessToken: unknown): Promise<SessionUser> {
  if (typeof accessToken !== "string" || accessToken.length > 8192 || !JWT.test(accessToken)) throw new AuthError(401, "Sign in again.");

  let claims: { userId: string; appId: string };
  try {
    claims = await privy.verifyAccessToken(accessToken);
  } catch {
    throw new AuthError(401, "Sign in again.");
  }
  if (claims.appId !== privy.appId || !claims.userId) throw new AuthError(401, "Sign in again.");

  let view: PrivyUserView;
  try {
    view = await privy.getUser(claims.userId);
  } catch {
    throw retry("Couldn't reach the sign-in service. Try again in a moment.");
  }
  if (view.id !== claims.userId) throw new AuthError(401, "Sign in again.");

  const [known] = await db.select().from(users).where(eq(users.privyUserId, view.id)).limit(1);
  if (known) {
    const current = view.email && known.email !== view.email ? await copyEmail(db, known, view.email) : known;
    return withWallet(db, current, view);
  }

  // A new person. Their wallet is decided once, here (P4); with none yet, nothing is created.
  const wallet = chooseWallet(view.wallets);
  if (!wallet) throw retry("Your wallet is still being set up. Wait a moment and sign in again.");
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.wallet, wallet)).limit(1);
  if (owner) throw new AuthError(409, "That wallet already belongs to another account.");
  const email = view.email && !(await emailTaken(db, view.email)) ? view.email : null;
  const [made] = await db.insert(users).values({ privyUserId: view.id, wallet, ...(email ? { email } : {}) }).onConflictDoNothing().returning();
  if (made) return made;
  // two first sign-ins racing: the unique indexes let one win and the other reads it back
  const [again] = await db.select().from(users).where(eq(users.privyUserId, view.id)).limit(1);
  if (!again) throw new AuthError(409, "Couldn't create the account. Try again.");
  return again;
}

const emailTaken = async (db: Database, email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)).length > 0;

/** Privy's verified email is copied in when the account has none or it changed, but never over another account's */
async function copyEmail(db: Database, user: SessionUser, email: string): Promise<SessionUser> {
  const [other] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, user.id))).limit(1);
  if (other) return user;
  const [set] = await db.update(users).set({ email }).where(eq(users.id, user.id)).returning();
  return set ?? user;
}

/** `users.wallet` is never changed by signing in; an account made without one gets it by the same rule as a new account */
async function withWallet(db: Database, user: SessionUser, view: PrivyUserView): Promise<SessionUser> {
  if (user.wallet) return user;
  const wallet = chooseWallet(view.wallets);
  if (!wallet) return user;
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.wallet, wallet)).limit(1);
  if (owner) throw new AuthError(409, "That wallet already belongs to another account.");
  const [set] = await db.update(users).set({ wallet }).where(eq(users.id, user.id)).returning();
  return set ?? user;
}
