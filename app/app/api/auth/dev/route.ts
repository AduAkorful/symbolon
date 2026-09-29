import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { DEV_USERS, devSignInAllowed } from "@/lib/server/dev-signin";
import { AuthError } from "@/lib/server/errors";
import { readBody, route, setSessionCookie } from "@/lib/server/http";
import { createSession } from "@/lib/server/session";
import { ensureDevWallet } from "@/lib/server/dev-wallet";
import { upsertDevUser } from "@/lib/server/users";

/** Local testing only (plan 05g, S6): a named test user, no wallet or code. Answers 404 anywhere else, as if it didn't exist. */
export const POST = route(async (request) => {
  if (!devSignInAllowed(getConfig())) throw new AuthError(404, "Not found.");
  const { key } = await readBody(request);
  const who = DEV_USERS.find((u) => u.key === key);
  if (!who) throw new AuthError(400, "Unknown test user.");
  const db = await getDb();
  const user = await upsertDevUser(db, who.email);
  await ensureDevWallet(db, user.id);
  const { token, expiresAt } = await createSession(db, user.id, "dev");
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ ok: true });
});
