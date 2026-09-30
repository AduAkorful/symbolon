import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getDb } from "@/lib/server/db";
import { requireSession, routeWith } from "@/lib/server/http";
import { loadActivity } from "@/lib/server/activity";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const client = getClient();

  const { searchParams } = new URL(request.url);
  const who = searchParams.get("who") ?? undefined;
  const vendor = searchParams.get("vendor") ?? undefined;
  const budget = searchParams.get("budget") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const feed = await loadActivity(db, client, session.user, businessId, {
    who,
    vendor,
    budget,
    from,
    to,
    cursor,
    limit,
  });

  return NextResponse.json({ ok: true, ...feed });
});
