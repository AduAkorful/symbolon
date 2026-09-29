import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { payoutOptions, preparePayee, recordPayee } from "@/lib/server/payee";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();
  if (body.action === "options") return NextResponse.json(await payoutOptions(db, getClient(), config.deployment, session.user, businessId, String(body.seal ?? "")));
  if (body.action === "prepare") return NextResponse.json(await preparePayee(db, getClient(), config.deployment, session.user, businessId, body.seal, body as never));
  if (body.action === "record") return NextResponse.json(await recordPayee(db, getClient(), config.deployment, session.user, businessId, body.txHash, body.seal));
  return NextResponse.json({ error: "Choose a payee action." }, { status: 400 });
});
