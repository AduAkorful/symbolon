import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { removeClient, updateClient, upsertClient } from "@/lib/server/vendor";

export const POST = route(async (request) => {
  const body = await readBody(request);
  const s = await requireSession();
  const db = await getDb();
  if (body.action === "update") return NextResponse.json(await updateClient(db, s.user, body));
  if (body.action === "remove") return NextResponse.json(await removeClient(db, s.user, body));
  return NextResponse.json(await upsertClient(db, s.user, body));
});
