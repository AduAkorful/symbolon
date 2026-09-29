import { NextResponse } from "next/server";
import { blockSeal } from "@/lib/server/inbox";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { createInvitation, revokeInvitation } from "@/lib/server/invitations";
import { getClient } from "@/lib/server/chain";
import { listVendors } from "@/lib/server/vendors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const s = await requireSession();
  const db = await getDb();
  if (body.action === "invite") return NextResponse.json(await createInvitation(db, s.user, id, body as never, getConfig().appOrigin));
  if (body.action === "revoke") return NextResponse.json(await revokeInvitation(db, s.user, id, String(body.invitationId ?? "")));
  if (body.action === "block" || body.action === "unblock") return NextResponse.json(await blockSeal(db, getConfig(), s.user, id, body.seal as string, body.action === "block"));
  return NextResponse.json({ error: "Choose a vendor action." }, { status: 400 });
});

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const config = getConfig();
  return NextResponse.json(await listVendors(await getDb(), getClient(), config.deployment, s.user, id));
});
