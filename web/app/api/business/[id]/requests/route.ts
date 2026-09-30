import { NextResponse } from "next/server";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { declineOffer } from "@/lib/server/offers";
import {
  listVendorRequests,
  prepareCancelPayoutChange,
  prepareConfirmPayoutChange,
  recordCancelPayoutChange,
  recordConfirmPayoutChange,
  rejectPayoutChangeRequest,
} from "@/lib/server/payout-change";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  await requireSession();
  const db = await getDb();
  const requests = await listVendorRequests(db, businessId);
  return NextResponse.json({ requests });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const body = await readBody(request);
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  if (body.action === "prepare_confirm") {
    const res = await prepareConfirmPayoutChange(
      db,
      config,
      session.user,
      businessId,
      String(body.requestId ?? ""),
    );
    return NextResponse.json(res);
  }

  if (body.action === "record_confirm") {
    if (typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.txHash)) {
      throw new AuthError(400, "Valid txHash is required.");
    }
    const res = await recordConfirmPayoutChange(
      db,
      client,
      session.user,
      businessId,
      {
        requestId: String(body.requestId ?? ""),
        txHash: body.txHash as `0x${string}`,
      },
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare_cancel") {
    const res = await prepareCancelPayoutChange(
      db,
      session.user,
      businessId,
      String(body.requestId ?? ""),
    );
    return NextResponse.json(res);
  }

  if (body.action === "record_cancel") {
    if (typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.txHash)) {
      throw new AuthError(400, "Valid txHash is required.");
    }
    const res = await recordCancelPayoutChange(
      db,
      client,
      session.user,
      businessId,
      {
        requestId: String(body.requestId ?? ""),
        txHash: body.txHash as `0x${string}`,
      },
    );
    return NextResponse.json(res);
  }

  if (body.action === "reject") {
    const res = await rejectPayoutChangeRequest(
      db,
      session.user,
      businessId,
      String(body.requestId ?? ""),
      body.reason ? String(body.reason) : undefined,
    );
    return NextResponse.json(res);
  }

  if (body.action === "decline_offer") {
    const res = await declineOffer(
      db,
      session.user,
      businessId,
      String(body.offerId ?? ""),
      body.reason ? String(body.reason) : undefined,
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
