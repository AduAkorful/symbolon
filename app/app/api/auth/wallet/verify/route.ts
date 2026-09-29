import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, route, setSessionCookie } from "@/lib/server/http";
import { createSession } from "@/lib/server/session";
import { verifyWalletSignIn } from "@/lib/server/siwe";
import { verifyOnChain } from "@/lib/server/siwe-verify";
import { upsertWalletUser } from "@/lib/server/users";

/** Step 2: the signed message comes back; if it is ours, fresh, for this site and chain, and the wallet signed it, a session starts */
export const POST = route(async (request) => {
  const { message, signature } = await readBody(request);
  if (typeof message !== "string" || typeof signature !== "string" || message.length > 2000) throw new AuthError(400, "Send the message and its signature.");
  const { appOrigin, chainId } = getConfig();
  const db = await getDb();
  const wallet = await verifyWalletSignIn(db, { appOrigin, chainId }, { message, signature }, verifyOnChain);
  const user = await upsertWalletUser(db, wallet);
  const { token, expiresAt } = await createSession(db, user.id, "wallet");
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ ok: true });
});
