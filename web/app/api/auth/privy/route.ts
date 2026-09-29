import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, route, setSessionCookie } from "@/lib/server/http";
import { getPrivy } from "@/lib/server/privy";
import { signInWithPrivy } from "@/lib/server/privy-signin";
import { rateLimit } from "@/lib/server/rate";
import { createSession } from "@/lib/server/session";

/** Plan 05k, P2. Privy's access token in; our own server-side session out. Nothing else in the body is read. */
export const POST = route(async (request) => {
  const who = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  rateLimit(`signin:${who}`, 30, 10 * 60_000, Date.now(), "Too many sign-in attempts. Wait a few minutes and try again.");
  const { accessToken } = await readBody(request);
  const db = await getDb();
  const user = await signInWithPrivy(db, getPrivy(), accessToken);
  const { token, expiresAt } = await createSession(db, user.id, "privy");
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ ok: true });
});
