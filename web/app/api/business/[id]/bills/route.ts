import { NextResponse } from "next/server";
import { addUnsignedBill } from "@/lib/server/unsigned";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { requireSession, routeWith } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate";
import { getStewardModel } from "@/lib/server/steward-model";

// Reading a file calls the model: up to 90 s in `readUpload`, plus margin. Vercel Hobby allows up to 300 s (docs read 2026-10-07).
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  rateLimit(`bill:${s.user.id}`, 10, 10 * 60_000);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AuthError(400, "Choose an invoice file.");
  const max = 8 * 1024 * 1024;
  if (file.size > max) throw new AuthError(400, "That file is too large.");
  return NextResponse.json(await addUnsignedBill(await getDb(), s.user, id, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }, getStewardModel()));
});
