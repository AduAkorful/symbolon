import { NextResponse } from "next/server";
import { requireMember } from "@/lib/server/access";
import { archiveThread, listEarlier } from "@/lib/server/ask-store";
import { getDb } from "@/lib/server/db";
import { requireSession, routeWith } from "@/lib/server/http";

// Plan 05zf: the signed-in person's own earlier conversations with the Steward for this business. Nobody else's.

export const GET = routeWith<{ params: Promise<{ id: string }> }>(async (_request, { params }) => {
  const session = await requireSession();
  const { id: businessId } = await params;
  const db = await getDb();
  await requireMember(db, session.user.id, businessId);
  return NextResponse.json({ ok: true, earlier: await listEarlier(db, businessId, session.user.id) });
});

/** "New conversation": moves the current thread aside as an earlier conversation */
export const POST = routeWith<{ params: Promise<{ id: string }> }>(async (_request, { params }) => {
  const session = await requireSession();
  const { id: businessId } = await params;
  const db = await getDb();
  await requireMember(db, session.user.id, businessId);
  const archived = await archiveThread(db, businessId, session.user.id);
  return NextResponse.json({ ok: true, archived, earlier: await listEarlier(db, businessId, session.user.id) });
});
