import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { sendAsDevWallet } from "@/lib/server/dev-wallet";
import { devSignInAllowed } from "@/lib/server/dev-signin";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";

/** Development only (plan 05h, H5): sends one call as the signed-in dev test user's local wallet. 404 anywhere else. */
export const POST = route(async (request) => {
  if (!devSignInAllowed(getConfig())) throw new AuthError(404, "Not found.");
  const { to, data } = await readBody(request);
  if (typeof to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(to) || typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) throw new AuthError(400, "Send a call: { to, data }.");
  const s = await requireSession();
  if (s.method !== "dev") throw new AuthError(403, "Only a test-user session can use the test wallet.");
  return NextResponse.json({ hash: await sendAsDevWallet(await getDb(), s.user.id, { to, data: data as `0x${string}` }) });
});
