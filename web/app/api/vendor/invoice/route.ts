import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, route } from "@/lib/server/http";
import { prepareInvoice, sendInvoice } from "@/lib/server/invoice-send";

/**
 * "prepare" builds the document and the exact typed data to sign (nothing is saved); "send" saves the signed invoice after checking
 * the signature against the person's own Seal.
 */
export const POST = route(async (request) => {
  const body = await readBody(request);
  const s = await requireSession();
  const db = await getDb();
  const cfg = getConfig();
  if (body.action === "prepare") {
    const r = await prepareInvoice(db, getClient(), cfg, s.user, body.draft as never);
    return NextResponse.json({ ...r });
  }
  if (body.action === "send") return NextResponse.json(await sendInvoice(db, getClient(), cfg, s.user, { document: body.document, signature: body.signature }));
  throw new AuthError(400, "Unknown action.");
});
