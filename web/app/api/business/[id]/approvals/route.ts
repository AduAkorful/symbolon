import { NextResponse } from "next/server";

import {
  listApprovals,
  prepareApproval,
  preparePayNow,
  recordPayNow,
  rejectApproval,
  releaseHold,
  submitApproval,
} from "@/lib/server/approvals";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const data = await listApprovals(db, client, config, session.user, businessId);
  return NextResponse.json(data);
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const action = body.action;

  if (action === "prepare-approval") {
    const res = await prepareApproval(db, client, config, session.user, businessId, body.fingerprint);
    return NextResponse.json(res);
  }

  if (action === "submit-approval") {
    const res = await submitApproval(db, client, config, session.user, businessId, {
      fingerprint: body.fingerprint,
      deadline: body.deadline,
      signature: body.signature,
    });
    return NextResponse.json(res);
  }

  if (action === "reject") {
    const res = await rejectApproval(db, client, config, session.user, businessId, {
      fingerprint: body.fingerprint,
      reason: body.reason,
    });
    return NextResponse.json(res);
  }

  if (action === "prepare-pay") {
    const res = await preparePayNow(db, client, config, session.user, businessId, body.fingerprint);
    return NextResponse.json(res);
  }

  if (action === "record-pay") {
    const res = await recordPayNow(
      db,
      client,
      config,
      session.user,
      businessId,
      body.txHash,
      body.fingerprint,
    );
    return NextResponse.json(res);
  }

  if (action === "release") {
    const res = await releaseHold(db, client, config, session.user, businessId, body.fingerprint);
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
