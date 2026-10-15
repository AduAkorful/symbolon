import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { users } from "@symbolon/db";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { updateDisplayName } from "@/lib/server/profile";

export const POST = route(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);

  if (typeof body.vendorVisible === "boolean") {
    await (await getDb()).update(users).set({ vendorVisible: body.vendorVisible }).where(eq(users.id, session.user.id));
    return NextResponse.json({ vendorVisible: body.vendorVisible });
  }

  if (typeof body.displayName !== "string") {
    return NextResponse.json({ error: "Display name is required." }, { status: 400 });
  }

  const db = await getDb();
  const result = await updateDisplayName(db, session.user.id, body.displayName);

  return NextResponse.json(result);
});
