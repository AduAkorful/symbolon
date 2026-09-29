import { NextResponse } from "next/server";
import { getCircleAuth } from "@/lib/server/circle";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { completeEmailSignIn } from "@/lib/server/email-signin";
import { AuthError } from "@/lib/server/errors";
import { readBody, route, setSessionCookie } from "@/lib/server/http";
import { createSession } from "@/lib/server/session";

/** After Circle's window accepts the code: the server checks the user token with Circle and starts a session, or asks for the wallet step */
export const POST = route(async (request) => {
  const { challengeId, userToken } = await readBody(request);
  if (typeof challengeId !== "string" || typeof userToken !== "string") throw new AuthError(400, "Send the challenge id and the user token.");
  const db = await getDb();
  const result = await completeEmailSignIn(db, getCircleAuth(), { challengeId, userToken, chainId: getConfig().chainId });
  if (result.status === "needs-wallet") return NextResponse.json(result);
  const { token, expiresAt } = await createSession(db, result.user.id, "circle");
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ status: "signed-in" });
});
