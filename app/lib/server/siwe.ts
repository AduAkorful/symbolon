import { and, eq, gt, isNull } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { authChallenges, type Database } from "@symbolon/db";
import { AuthError } from "./errors";

// Plan 05g, S3: Sign-In with Ethereum (EIP-4361). The server writes the message and remembers its nonce; a signed message
// counts once, only for this app's origin and chain, and only while its nonce is fresh.
export const NONCE_TTL_MS = 10 * 60 * 1000;

export interface SiweSettings {
  appOrigin: string;
  chainId: number;
}

/** Checks a signature for an address: a plain key first, then a smart-contract wallet (ERC-1271, and ERC-6492 for undeployed ones) */
export type SignatureVerifier = (a: { address: Address; message: string; signature: Hex }) => Promise<boolean>;

const STATEMENT = "Sign in to Symbolon. This doesn't send a transaction and costs nothing.";

export async function issueWalletChallenge(db: Database, s: SiweSettings, wallet: string, now = new Date()): Promise<{ message: string }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new AuthError(400, "That isn't a wallet address.");
  const nonce = generateSiweNonce();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS);
  await db.insert(authChallenges).values({ kind: "siwe", nonce, createdAt: now, expiresAt });
  const message = createSiweMessage({
    address: getAddress(wallet),
    chainId: s.chainId,
    domain: new URL(s.appOrigin).host,
    nonce,
    uri: s.appOrigin,
    version: "1",
    statement: STATEMENT,
    issuedAt: now,
    expirationTime: expiresAt,
  });
  return { message };
}

const refuse = (why: string) => new AuthError(401, `Sign-in refused: ${why}.`);

/** The wallet address (lowercase) that signed a message this server issued. Throws AuthError(401) for anything else. */
export async function verifyWalletSignIn(
  db: Database,
  s: SiweSettings,
  a: { message: string; signature: string },
  verify: SignatureVerifier,
  now = new Date(),
): Promise<string> {
  if (!/^0x[0-9a-fA-F]+$/.test(a.signature)) throw refuse("the signature isn't valid hex");
  const m = parseSiweMessage(a.message);
  if (!m.address || !m.nonce || !m.domain || !m.uri || m.chainId === undefined || m.version !== "1") throw refuse("the message is incomplete");
  if (m.chainId !== s.chainId) throw refuse("the message is for a different chain");
  if (m.domain !== new URL(s.appOrigin).host || new URL(m.uri).origin !== s.appOrigin) throw refuse("the message is for a different site");
  // a message that lacks an expiry would never lapse on its own: ours always carries one
  if (!m.expirationTime) throw refuse("the message has no expiry");
  if (!validateSiweMessage({ message: m, domain: new URL(s.appOrigin).host, nonce: m.nonce, time: now })) throw refuse("the message has expired");

  // Spend the nonce first and atomically: two requests with one message can't both get past this line
  const [spent] = await db
    .update(authChallenges)
    .set({ consumedAt: now })
    .where(and(eq(authChallenges.kind, "siwe"), eq(authChallenges.nonce, m.nonce), isNull(authChallenges.consumedAt), gt(authChallenges.expiresAt, now)))
    .returning({ id: authChallenges.id });
  if (!spent) throw refuse("that sign-in link was already used, expired, or never issued");

  const address = getAddress(m.address);
  let ok = false;
  try {
    ok = await verify({ address, message: a.message, signature: a.signature as Hex });
  } catch {
    // a failed verification (RPC down for a smart-contract wallet, malformed signature) is a refusal, never a pass
    throw new AuthError(502, "Couldn't check that signature right now. Try again.");
  }
  if (!ok) throw refuse("the signature doesn't match that wallet");
  return address.toLowerCase();
}
