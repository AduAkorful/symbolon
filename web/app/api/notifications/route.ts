import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { markNotifications } from "@/lib/server/notifications";

export const POST = route(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);

  const action = body.action;
  if (action !== "read" && action !== "unread" && action !== "read-all") {
    return NextResponse.json({ error: "Action must be read, unread, or read-all." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? (body.ids.filter((id): id is string => typeof id === "string"))
    : undefined;

  const db = await getDb();
  await markNotifications(db, session.user.id, action, ids);

  return NextResponse.json({ ok: true });
});
