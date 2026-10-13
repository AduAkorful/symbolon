import { NextResponse } from "next/server";
import { getSession, route } from "@/lib/server/http";

/** Whether this browser has a live session: a yes or no and nothing else, so public pages can offer "Open the app" instead of "Sign in". */
export const GET = route(async () => {
  const s = await getSession();
  return NextResponse.json({ signedIn: s !== null }, { headers: { "Cache-Control": "private, no-store" } });
});
