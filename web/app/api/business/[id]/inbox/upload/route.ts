import { NextResponse } from "next/server";
import { addSealedInvoice } from "@/lib/server/inbox";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AuthError(400, "Choose a .symbolon file.");
  if (file.size > 1_048_576) throw new AuthError(400, "That sealed file is too large.");
  let envelope: unknown;
  try { envelope = JSON.parse(await file.text()); } catch { throw new AuthError(400, "That isn't a valid sealed invoice file."); }
  return NextResponse.json(await addSealedInvoice(await getDb(), getClient(), getConfig(), s.user, id, envelope, "upload"));
});
