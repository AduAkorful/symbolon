import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { AuthError } from "@/lib/server/errors";
import { checkRegistrationSignature, registrationTypedDataJson } from "@/lib/server/seal-registration";
import { cleanRegistration, handleAvailable, registerMySeal } from "@/lib/server/vendor";

/** Registers the signed-in person's Seal: their own wallet, a handle and the name on their invoices */
export const POST = route(async (request) => {
  const body = await readBody(request);
  const s = await requireSession();
  const chainId = getConfig().chainId;
  const wallet = s.user.wallet;
  // step one: the exact text the wallet will be asked to sign; nothing is written (plan 05zo)
  if (body.action === "prepare") {
    if (!wallet) throw new AuthError(409, "This account has no wallet to hold a Seal. Sign in with a wallet, or with an email that has one.");
    const fields = cleanRegistration(body);
    const issuedAt = Math.floor(Date.now() / 1000);
    return NextResponse.json({ typedData: registrationTypedDataJson(chainId, wallet, fields, issuedAt), issuedAt, fields });
  }
  const verify = (fields: Parameters<typeof checkRegistrationSignature>[3], issuedAt: unknown, signature: unknown) =>
    checkRegistrationSignature(getClient(), chainId, wallet ?? "", fields, issuedAt, signature);
  return NextResponse.json(await registerMySeal(await getDb(), s.user, body, verify));
});

/** Whether a handle is free (`?handle=`). Reads only. */
export async function GET(request: Request) {
  const s = await requireSession().catch(() => null);
  if (!s) return NextResponse.json({ error: "You're signed out." }, { status: 401 });
  return NextResponse.json(await handleAvailable(await getDb(), new URL(request.url).searchParams.get("handle")));
}
