import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { businessOffers, declineOffer, sendCounter } from "@/lib/server/offers";
import { AuthError } from "@/lib/server/errors";

export const GET = routeWith(async (request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await context.params;
  const fingerprint = new URL(request.url).searchParams.get("fingerprint") ?? "";
  return NextResponse.json(await businessOffers(await getDb(), session.user, id, fingerprint));
});
export const POST = routeWith(async (request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const { id } = await context.params;
  const body = await readBody(request);
  const db = await getDb();
  if (body.action === "decline") return NextResponse.json(await declineOffer(db, session.user, id, String(body.offerId ?? "")));
  if (body.action === "counter") return NextResponse.json(await sendCounter(db, getClient(), getConfig(), session.user, id, String(body.fingerprint ?? "")));
  throw new AuthError(400, "Unknown action.");
});
