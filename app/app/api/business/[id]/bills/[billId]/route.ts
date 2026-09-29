import { NextResponse } from "next/server";
import { updateUnsignedBill } from "@/lib/server/unsigned";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string; billId: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id, billId } = await ctx.params;
  const body = await readBody(request);
  if (body.action !== "fraud" && body.action !== "dismiss") throw new AuthError(400, "Unknown bill action.");
  const s = await requireSession();
  return NextResponse.json(await updateUnsignedBill(await getDb(), s.user, id, billId, body.action === "fraud" ? "fraud" : "dismissed"));
});
