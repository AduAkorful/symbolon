import { NextResponse } from "next/server";
import { createBusiness, findBusinessConflict } from "@/lib/server/business";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";

/** Creates a business with the signed-in person as its owner. No Vault yet. */
export const POST = route(async (request) => {
  const { name, confirm } = await readBody(request);
  if (typeof name !== "string") throw new AuthError(400, "Send the business name.");
  const s = await requireSession();
  const db = await getDb();
  const chainId = getConfig().chainId;
  // An unfinished business, or the same name again, is said before a second one is made; confirming goes on (plan 05zj D, SYM-15)
  if (confirm !== true) {
    const conflict = await findBusinessConflict(db, s.user, name, chainId);
    if (conflict) return NextResponse.json({ conflict });
  }
  return NextResponse.json(await createBusiness(db, s.user, name, chainId));
});
