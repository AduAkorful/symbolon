import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { preparePayeeTerms, recordPayeeTerms } from "@/lib/server/payee-terms";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  if (body.action === "prepare") {
    const rawTerms = body.terms as Record<string, unknown>;
    const res = await preparePayeeTerms(db, getClient(), config.deployment, session.user, businessId, {
      seal: String(body.seal ?? ""),
      terms: {
        budget: String(rawTerms.budget ?? "") as Hex,
        requirePo: Boolean(rawTerms.requirePo),
        requireDelivery: Boolean(rawTerms.requireDelivery),
        monthlyCap: BigInt(String(rawTerms.monthlyCap ?? 0)),
      },
    });
    return NextResponse.json(res);
  }

  if (body.action === "record") {
    const res = await recordPayeeTerms(
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
