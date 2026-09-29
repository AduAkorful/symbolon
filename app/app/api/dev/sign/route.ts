import { NextResponse } from "next/server";
import { getConfig } from "@/lib/server/config";
import { signInvoiceAsDevSeal } from "@/lib/server/dev-wallet";
import { devSignInAllowed } from "@/lib/server/dev-signin";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";

/** Development only (plan 05i, V4): signs an invoice as the signed-in dev test user's Seal. 404 anywhere else. */
export const POST = route(async (request) => {
  if (!devSignInAllowed(getConfig())) throw new AuthError(404, "Not found.");
  const { document } = await readBody(request);
  const s = await requireSession();
  if (s.method !== "dev") throw new AuthError(403, "Only a test-user session can use the test wallet.");
  return NextResponse.json({ signature: await signInvoiceAsDevSeal(s.user.id, document) });
});
