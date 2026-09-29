import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { acceptInvitation } from "@/lib/server/invitations";
import { readBody, requireSession, route } from "@/lib/server/http";

export const POST = route(async (request) => {
  const body = await readBody(request);
  const session = await requireSession();
  return NextResponse.json(await acceptInvitation(await getDb(), getClient(), getConfig().deployment, session.user, body.token));
});
