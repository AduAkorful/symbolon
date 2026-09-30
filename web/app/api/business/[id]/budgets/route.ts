import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  listBudgets,
  prepareCreateBudget,
  recordCreateBudget,
  prepareEditBudget,
  recordEditBudget,
} from "@/lib/server/budgets";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  const data = await listBudgets(db, getClient(), config.deployment, session.user, businessId);
  return NextResponse.json({ ok: true, ...data });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  if (body.action === "prepare-create") {
    const res = await prepareCreateBudget(db, getClient(), config.deployment, session.user, businessId, {
      name: String(body.name ?? ""),
      cap: BigInt(String(body.cap ?? 0)),
      periodLength: BigInt(String(body.periodLength ?? 0)),
    });
    return NextResponse.json(res);
  }

  if (body.action === "record-create") {
    const res = await recordCreateBudget(db, getClient(), config.deployment, session.user, businessId, {
      txHash: body.txHash as Hex,
      name: String(body.name ?? ""),
    });
    return NextResponse.json(res);
  }

  if (body.action === "prepare-edit") {
    const res = await prepareEditBudget(db, getClient(), config.deployment, session.user, businessId, {
      budgetId: body.budgetId as Hex,
      cap: BigInt(String(body.cap ?? 0)),
      periodLength: BigInt(String(body.periodLength ?? 0)),
    });
    return NextResponse.json(res);
  }

  if (body.action === "record-edit") {
    const res = await recordEditBudget(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.txHash as Hex,
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
});
