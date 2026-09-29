import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { clearSessionCookie, requireSession, route } from "@/lib/server/http";
import { revokeAllSessions } from "@/lib/server/session";

/** Ends every session this person has, on every device, including this one */
export const POST = route(async () => {
  const s = await requireSession();
  await revokeAllSessions(await getDb(), s.user.id);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
