import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { prepareDelivery, recordDelivery } from "@/lib/server/delivery";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();

  const isPrepare = body.action === "prepare" || body.action === "prepare_confirm" || body.action === "prepare_reject";
  const isRecord = body.action === "record" || body.action === "record_confirm" || body.action === "record_reject";
  const actionType =
    body.action === "prepare_confirm" || body.action === "record_confirm"
      ? "confirm"
      : body.action === "prepare_reject" || body.action === "record_reject"
      ? "reject"
      : (body.deliveryAction ?? body.subAction ?? body.type ?? "confirm");

  if (isPrepare && actionType === "confirm") {
    return NextResponse.json(
      await prepareDelivery(db, getClient(), config, session.user, businessId, {
        action: "confirm",
        fingerprint: body.fingerprint,
      }),
    );
  }
  if (isPrepare && actionType === "reject") {
    return NextResponse.json(
      await prepareDelivery(db, getClient(), config, session.user, businessId, {
        action: "reject",
        fingerprint: body.fingerprint,
        reason: body.reason,
      }),
    );
  }
  if (isRecord && actionType === "confirm") {
    return NextResponse.json(
      await recordDelivery(db, getClient(), config, session.user, businessId, {
        action: "confirm",
        fingerprint: body.fingerprint,
        txHash: body.txHash,
      }),
    );
  }
  if (isRecord && actionType === "reject") {
    return NextResponse.json(
      await recordDelivery(db, getClient(), config, session.user, businessId, {
        action: "reject",
        fingerprint: body.fingerprint,
        txHash: body.txHash,
        reason: body.reason,
      }),
    );
  }
  return NextResponse.json({ error: "Choose a delivery action." }, { status: 400 });
});
