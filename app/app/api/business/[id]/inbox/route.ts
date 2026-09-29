import { NextResponse } from "next/server";
import { addSealedInvoice, claimInvoice, claimable, listInbox, type InboxFilter } from "@/lib/server/inbox";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { eq } from "drizzle-orm";
import { invoices } from "@symbolon/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = async (request: Request, ctx: Ctx) => {
  try {
    const s = await requireSession();
    const { id } = await ctx.params;
    const filter = new URL(request.url).searchParams.get("filter") as InboxFilter | null;
    const cfg = getConfig();
    const db = await getDb();
    const items = await listInbox(db, getClient(), cfg, s.user, id, filter && ["all", "verified", "new", "unsigned", "blocked"].includes(filter) ? filter : "all");
    const claims = await claimable(db, cfg, s.user, s.method, id);
    return NextResponse.json({ items, claimable: claims.map((r) => ({ fingerprint: r.fingerprint, invoiceNumber: r.invoiceNumber })) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("inbox failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
  }
};

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const s = await requireSession();
  const cfg = getConfig();
  const db = await getDb();
  if (body.action === "claim") return NextResponse.json(await claimInvoice(db, cfg, s.user, s.method, id, body.fingerprint as string));
  if (body.action === "add") {
    if (typeof body.fingerprint !== "string") throw new AuthError(400, "Send an invoice fingerprint.");
    const [row] = await db.select({ envelope: invoices.envelope }).from(invoices).where(eq(invoices.fingerprint, body.fingerprint.toLowerCase())).limit(1);
    if (!row) throw new AuthError(404, "That invoice link isn't from this deployment.");
    return NextResponse.json(await addSealedInvoice(db, getClient(), cfg, s.user, id, row.envelope, "link"));
  }
  throw new AuthError(400, "Unknown inbox action.");
});
