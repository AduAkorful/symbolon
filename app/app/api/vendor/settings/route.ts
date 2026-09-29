import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, route } from "@/lib/server/http";
import { saveVendorSettings } from "@/lib/server/vendor";

export const POST = route(async (request) => {
  const body = await readBody(request);
  const s = await requireSession();
  return NextResponse.json(await saveVendorSettings(await getDb(), s.user, body));
});
