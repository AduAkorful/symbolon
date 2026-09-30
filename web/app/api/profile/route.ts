import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { updateDisplayName } from "@/lib/server/profile";

export const POST = route(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);

  if (typeof body.displayName !== "string") {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }

  const db = await getDb();
  const result = await updateDisplayName(db, session.user.id, body.displayName);

  return NextResponse.json(result);
});
