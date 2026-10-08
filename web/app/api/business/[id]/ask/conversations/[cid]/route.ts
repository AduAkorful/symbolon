import { NextResponse } from "next/server";
import { requireMember } from "@/lib/server/access";
import { deleteEarlier, listEarlier, loadEarlier } from "@/lib/server/ask-store";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { requireSession, routeWith } from "@/lib/server/http";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; cid: string }> };

async function scope(params: Ctx["params"]) {
  const session = await requireSession();
  const { id: businessId, cid } = await params;
  if (!UUID.test(cid)) throw new AuthError(404, "That conversation wasn't found.");
  const db = await getDb();
  await requireMember(db, session.user.id, businessId);
  return { db, businessId, cid, userId: session.user.id };
}

/** One earlier conversation, read-only; 404 when it isn't the signed-in person's */
export const GET = routeWith<Ctx>(async (_request, { params }) => {
  const { db, businessId, cid, userId } = await scope(params);
  const messages = await loadEarlier(db, businessId, userId, cid);
  if (messages.length === 0) throw new AuthError(404, "That conversation wasn't found.");
  return NextResponse.json({ ok: true, messages: messages.map((m) => ({ question: m.question, answer: m.answer })) });
});

/** Deletes one earlier conversation, the author's only */
export const DELETE = routeWith<Ctx>(async (_request, { params }) => {
  const { db, businessId, cid, userId } = await scope(params);
  await deleteEarlier(db, businessId, userId, cid);
  return NextResponse.json({ ok: true, earlier: await listEarlier(db, businessId, userId) });
});
