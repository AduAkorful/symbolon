import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { showCodeToSeal } from "@/lib/server/verification";
import { requireSession, route } from "@/lib/server/http";

export const GET = route(async (request) => {
  const session = await requireSession();
  const requestId = new URL(request.url).searchParams.get("request") ?? undefined;
  return NextResponse.json(await showCodeToSeal(await getDb(), session.user, requestId));
});
