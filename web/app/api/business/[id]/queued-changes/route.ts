import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  listQueuedChanges,
  prepareCancelChange,
  prepareChange,
  recordChange,
  type QueuedChangeSpec,
} from "@/lib/server/queued-change";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  await requireSession();
  const db = await getDb();
  const changes = await listQueuedChanges(db, businessId);
  return NextResponse.json({ ok: true, changes });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();

  if (body.action === "prepare") {
    const res = await prepareChange(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.spec as QueuedChangeSpec,
    );
    return NextResponse.json(res);
  }

  if (body.action === "record") {
    const res = await recordChange(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.txHash as Hex,
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare-cancel") {
    const res = await prepareCancelChange(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.changeId as Hex,
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown queued changes action." }, { status: 400 });
});
