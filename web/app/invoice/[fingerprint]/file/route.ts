import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { loadPublicInvoice } from "@/lib/server/public-invoice";

/** The sealed invoice as a `.symbolon` file (its canonical JSON). Only an invoice that passes the check right now is served. */
export async function GET(_request: Request, ctx: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await ctx.params;
  const view = await loadPublicInvoice(await getDb(), getClient(), getConfig(), fingerprint);
  if (!view || view.state !== "genuine") return new Response("Not found", { status: 404 });
  const number = view.document.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  return new Response(view.envelope, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="invoice-${number}.symbolon"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
