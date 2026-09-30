import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import {
  complianceReport,
  prepareScreeningWrite,
  recordScreeningWrite,
  screenPayee,
} from "@/lib/server/compliance";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();

  if (body.action === "screen") {
    const row = await screenPayee(
      db,
      config,
      session.user,
      businessId,
      body.seal,
      { target: body.target as any, client: getClient(), deployment: config.deployment },
    );
    return NextResponse.json({ ok: true, screening: row });
  }

  if (body.action === "prepare-write") {
    const call = await prepareScreeningWrite(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      String(body.screeningId ?? ""),
    );
    return NextResponse.json(call);
  }

  if (body.action === "record-write") {
    const result = await recordScreeningWrite(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.txHash,
      String(body.screeningId ?? ""),
    );
    return NextResponse.json(result);
  }

  if (body.action === "report") {
    const csv = await complianceReport(
      db,
      businessId,
      body.from ? new Date(body.from as string) : undefined,
      body.to ? new Date(body.to as string) : undefined,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="compliance-report.csv"',
      },
    });
  }

  return NextResponse.json({ error: "Unknown compliance action." }, { status: 400 });
});

export const GET = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (format === "csv") {
    const csv = await complianceReport(
      db,
      businessId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="compliance-report-${businessId}.csv"`,
      },
    });
  }

  return NextResponse.json({ error: "Specify ?format=csv to download compliance report." }, { status: 400 });
});
