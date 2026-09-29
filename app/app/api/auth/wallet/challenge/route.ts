import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, route } from "@/lib/server/http";
import { issueWalletChallenge } from "@/lib/server/siwe";
import { AuthError } from "@/lib/server/errors";

/** Step 1 of signing in with your own wallet: the server writes the message to sign and remembers its one-time nonce */
export const POST = route(async (request) => {
  const { address } = await readBody(request);
  if (typeof address !== "string") throw new AuthError(400, "Send the wallet address to sign in with.");
  const { appOrigin, chainId } = getConfig();
  return NextResponse.json(await issueWalletChallenge(await getDb(), { appOrigin, chainId }, address));
});
