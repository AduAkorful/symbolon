import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { confirmSecond, startCodeVerification, submitCode } from "@/lib/server/verification";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  if (body.action === "start") return NextResponse.json(await startCodeVerification(db, session.user, businessId, body.seal, body.cap));
  if (body.action === "code") return NextResponse.json(await submitCode(db, session.user, getClient(), getConfig().deployment, String(body.requestId ?? ""), body.code, body.contacted, body.channel));
  if (body.action === "second") return NextResponse.json(await confirmSecond(db, session.user, String(body.requestId ?? "")));
  return NextResponse.json({ error: "Choose a verification action." }, { status: 400 });
});
