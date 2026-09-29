import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { loadInvoiceDetail } from "@/lib/server/inbox";
import { requireSession } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string; fingerprint: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id, fingerprint } = await ctx.params;
    const s = await requireSession();
    const view = await loadInvoiceDetail(await getDb(), getClient(), getConfig(), s.user, id, fingerprint);
    if (!view) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return new NextResponse(JSON.stringify(view, (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value), { headers: { "content-type": "application/json" } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("invoice detail failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
  }
}
