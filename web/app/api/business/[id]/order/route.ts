import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { listOrders, prepareOpenPo, recordOpenPo, prepareClosePo, recordClosePo } from "@/lib/server/orders";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();
  const orders = await listOrders(db, getClient(), config.deployment, session.user, businessId);
  // Serialise BigInt amounts to strings (can't JSON.stringify bigint directly)
  return NextResponse.json(
    orders.map((o) => ({
      ...o,
      amount: String(o.amount),
      invoicedTotal: String(o.invoicedTotal),
      paidTotal: String(o.paidTotal),
      releaseAfter: o.releaseAfter?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      closedAt: o.closedAt?.toISOString() ?? null,
    })),
  );
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();

  if (body.action === "prepare_open" || body.action === "prepare") {
    return NextResponse.json(
      await prepareOpenPo(db, getClient(), config.deployment, session.user, businessId, {
        poNumber: body.poNumber,
        seal: body.seal,
        amount: body.amount,
        description: body.description,
        releaseDate: body.releaseDate,
      }),
    );
  }
  if (body.action === "record_open" || body.action === "record") {
    return NextResponse.json(
      await recordOpenPo(db, getClient(), config.deployment, session.user, businessId, body.txHash, body.poNumber, body.description),
    );
  }
  if (body.action === "prepare_close" || body.action === "prepare-close") {
    return NextResponse.json(
      await prepareClosePo(db, getClient(), config.deployment, session.user, businessId, body.poRef),
    );
  }
  if (body.action === "record_close" || body.action === "record-close") {
    return NextResponse.json(
      await recordClosePo(db, getClient(), config.deployment, session.user, businessId, body.txHash, body.poRef),
    );
  }
  return NextResponse.json({ error: "Choose an order action." }, { status: 400 });
});
