import { NextResponse } from "next/server";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { requireSession, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate";
import { getStewardModel } from "@/lib/server/steward-model";
import { MAX_PDF_BYTES, readUpload } from "@/lib/server/upload";
import { requireMySeal } from "@/lib/server/vendor";

// Reading a file calls the model: up to 90 s in `readUpload`, plus margin. Vercel Hobby allows up to 300 s (docs read 2026-10-07).
export const maxDuration = 120;

/**
 * Reads an uploaded invoice (PDF or plain text) into a draft for the composer (plan 05i, V13). The file is read in memory and not stored;
 * the answer is a draft to confirm, never a sealed invoice.
 */
export const POST = route(async (request) => {
  const s = await requireSession();
  await requireMySeal(await getDb(), s.user.id);
  const model = getStewardModel();
  if (!model) throw new AuthError(503, "Reading uploaded invoices isn't available right now. You can write the invoice yourself.");
  rateLimit(`upload:${s.user.id}`, 10, 10 * 60_000);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_PDF_BYTES + 64 * 1024) throw new AuthError(400, "That file is too large.");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AuthError(400, "Choose a file to upload.");
  if (file.size > MAX_PDF_BYTES) throw new AuthError(400, "That file is too large.");
  return NextResponse.json(await readUpload(model, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }));
});
