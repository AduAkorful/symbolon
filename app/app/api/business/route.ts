import { NextResponse } from "next/server";
import { createBusiness } from "@/lib/server/business";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";

/** Creates a business with the signed-in person as its owner. No Vault yet. */
export const POST = route(async (request) => {
  const { name } = await readBody(request);
  if (typeof name !== "string") throw new AuthError(400, "Send the business name.");
  const s = await requireSession();
  return NextResponse.json(await createBusiness(await getDb(), s.user, name, getConfig().chainId));
});
