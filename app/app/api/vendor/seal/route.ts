import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { handleAvailable, registerMySeal } from "@/lib/server/vendor";

/** Registers the signed-in person's Seal: their own wallet, a handle and the name on their invoices */
export const POST = route(async (request) => {
  const body = await readBody(request);
  const s = await requireSession();
  return NextResponse.json(await registerMySeal(await getDb(), s.user, body));
});

/** Whether a handle is free (`?handle=`). Reads only. */
export async function GET(request: Request) {
  const s = await requireSession().catch(() => null);
  if (!s) return NextResponse.json({ error: "You're signed out." }, { status: 401 });
  return NextResponse.json(await handleAvailable(await getDb(), new URL(request.url).searchParams.get("handle")));
}
