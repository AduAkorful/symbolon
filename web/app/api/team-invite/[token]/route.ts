import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { requireSession, routeWith } from "@/lib/server/http";
import {
  acceptTeamInvitation,
  getInvitationByToken,
} from "@/lib/server/team-invitations";

type Ctx = { params: Promise<{ token: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { token } = await ctx.params;
  const db = await getDb();

  const invitation = await getInvitationByToken(db, token);
  return NextResponse.json({ ok: true, invitation });
});

export const POST = routeWith<Ctx>(async (_request, ctx) => {
  const { token } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();

  const result = await acceptTeamInvitation(db, session.user, token);
  return NextResponse.json({ ok: true, ...result });
});
