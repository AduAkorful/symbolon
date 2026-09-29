import { and, count, eq, gt, isNull } from "drizzle-orm";
import { authChallenges, type Database } from "@symbolon/db";
import { circleBlockchain, type CircleAuth } from "./circle-auth";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { upsertCircleUser } from "./users";

// Plan 05g, "The Circle path". The server, not the browser, decides which email a sign-in is for: it asks Circle to send the
// code and remembers the email against a challenge. The browser only ever returns the challenge id and Circle's user token.
export const EMAIL_CHALLENGE_TTL_MS = 10 * 60 * 1000;
/** Each request makes Circle send a real email, so one address can't be used to spam someone or burn our quota */
const MAX_CODES_PER_EMAIL_PER_HOUR = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function startEmailSignIn(
  db: Database,
  circle: CircleAuth,
  a: { email: string; deviceId: string },
  now = new Date(),
): Promise<{ challengeId: string; deviceToken: string; deviceEncryptionKey: string; otpToken: string }> {
  const email = a.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new AuthError(400, "That doesn't look like an email address.");
  if (!a.deviceId || a.deviceId.length > 200) throw new AuthError(400, "This browser couldn't be identified. Reload and try again.");

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(authChallenges)
    .where(and(eq(authChallenges.kind, "email"), eq(authChallenges.email, email), gt(authChallenges.createdAt, hourAgo)));
  if (n >= MAX_CODES_PER_EMAIL_PER_HOUR) throw new AuthError(429, "Too many codes were requested for that address. Try again in an hour.");

  const session = await circle.requestEmailOtp({ deviceId: a.deviceId, email });
  const [row] = await db
    .insert(authChallenges)
    .values({ kind: "email", email, deviceId: a.deviceId, createdAt: now, expiresAt: new Date(now.getTime() + EMAIL_CHALLENGE_TTL_MS) })
    .returning({ id: authChallenges.id });
  return { challengeId: row!.id, ...session };
}

export type EmailSignInResult = { status: "signed-in"; user: SessionUser } | { status: "needs-wallet"; walletChallengeId: string };

export async function completeEmailSignIn(
  db: Database,
  circle: CircleAuth,
  a: { challengeId: string; userToken: string; chainId: number },
  now = new Date(),
): Promise<EmailSignInResult> {
  if (!/^[0-9a-f-]{36}$/.test(a.challengeId) || !a.userToken) throw new AuthError(400, "That sign-in request is incomplete.");
  const [challenge] = await db
    .select()
    .from(authChallenges)
    .where(and(eq(authChallenges.id, a.challengeId), eq(authChallenges.kind, "email"), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, now)))
    .limit(1);
  if (!challenge?.email) throw new AuthError(401, "That sign-in has expired or was already used. Start again.");

  // Circle refuses an invalid or expired token here (401); anything it returns belongs to the user the token names
  const wallets = await circle.listWallets(a.userToken);
  const chain = circleBlockchain(a.chainId);
  const usable = wallets.filter((w) => w.blockchain === chain && w.state === "LIVE" && w.userId && /^0x[0-9a-f]{40}$/.test(w.address));
  const wallet = usable.find((w) => w.accountType === "EOA") ?? usable[0];

  if (!wallet) {
    // First time: the browser must run Circle's wallet-creation challenge, then come back. Our challenge stays open for that.
    const init = await circle.initializeUser(a.userToken, a.chainId);
    if ("challengeId" in init) return { status: "needs-wallet", walletChallengeId: init.challengeId };
    throw new AuthError(409, "Your wallet isn't ready to use yet, or isn't active. Wait a few seconds and try again.");
  }

  // Single use, atomically, before any account is touched
  const [spent] = await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(authChallenges.id, challenge.id), isNull(authChallenges.consumedAt)))
    .returning({ id: authChallenges.id });
  if (!spent) throw new AuthError(401, "That sign-in has expired or was already used. Start again.");

  const user = await upsertCircleUser(db, { circleUserId: wallet.userId, email: challenge.email, wallet: wallet.address });
  return { status: "signed-in", user };
}
