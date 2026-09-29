import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { clearSessionCookie, getSession, route } from "@/lib/server/http";
import { revokeSession } from "@/lib/server/session";

/** Ends this browser's session. Signed out already is fine: the answer is the same. */
export const POST = route(async () => {
  const s = await getSession();
  if (s) await revokeSession(await getDb(), s.sessionId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
