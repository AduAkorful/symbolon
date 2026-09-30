import { NextResponse } from "next/server";
import { symbolonContracts } from "@symbolon/chain";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  exportAccounting,
  loadAccounting,
  resyncLedger,
} from "@/lib/server/accounting";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();
  const client = getClient();

  const { searchParams } = new URL(request.url);
  const exportFormat = searchParams.get("export");
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  if (exportFormat === "csv" || exportFormat === "beancount") {
    const res = await exportAccounting(db, session.user, businessId, exportFormat, { from, to });
    const mime = exportFormat === "beancount" ? "text/plain; charset=utf-8" : "text/csv; charset=utf-8";
    return new Response(res.content, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${res.filename}"`,
        "X-Export-Sha256": res.sha256,
      },
    });
  }

  const contracts = symbolonContracts(client, config.deployment);
  const data = await loadAccounting(db, contracts, client, config.deployment, session.user, businessId, { from, to });
  return NextResponse.json({ ok: true, data });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();
  const client = getClient();
  const contracts = symbolonContracts(client, config.deployment);

  if (body.action === "resync") {
    const res = await resyncLedger(db, client, contracts, config.deployment, session.user, businessId);
    return NextResponse.json({ ok: true, ...res });
  }

  if (body.action === "export") {
    const format = body.format === "beancount" ? "beancount" : "csv";
    const res = await exportAccounting(db, session.user, businessId, format, {
      from: typeof body.from === "string" ? body.from : undefined,
      to: typeof body.to === "string" ? body.to : undefined,
    });
    return NextResponse.json({ ok: true, ...res });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
});
