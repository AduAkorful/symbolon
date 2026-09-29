import { NextResponse } from "next/server";
import { askForSealed, updateUnsignedBill } from "@/lib/server/unsigned";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string; billId: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id, billId } = await ctx.params;
  const body = await readBody(request);
  const s = await requireSession();
  if (body.action === "ask") return NextResponse.json(await askForSealed(await getDb(), s.user, id, billId, body as never, getConfig().appOrigin));
  if (body.action !== "fraud" && body.action !== "dismiss") throw new AuthError(400, "Unknown bill action.");
  return NextResponse.json(await updateUnsignedBill(await getDb(), s.user, id, billId, body.action === "fraud" ? "fraud" : "dismissed"));
});
