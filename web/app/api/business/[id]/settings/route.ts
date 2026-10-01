import { NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  loadSettings,
  renameBusiness,
  setEarlyPay,
  setBufferDays,
} from "@/lib/server/settings";
import {
  loadReleaseInfo,
  checkReleaseNudge,
  prepareScheduleUpgrade,
  recordScheduleUpgrade,
  prepareCancelUpgrade,
  recordCancelUpgrade,
  prepareUpgrade,
  recordUpgrade,
} from "@/lib/server/release";
import { prepareChange, recordChange, listQueuedChanges } from "@/lib/server/queued-change";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();
  const client = getClient();

  const settingsData = await loadSettings(
    db,
    client,
    config.deployment,
    session.user,
    businessId,
  );

  let release = null;
  let nudge = { hasNudge: false };
  let queuedChanges: unknown[] = [];

  if (settingsData.business.vault) {
    const vault = getAddress(settingsData.business.vault);
    const [relInfo, nudgeInfo, changes] = await Promise.all([
      loadReleaseInfo(client, config.deployment, vault).catch(() => null),
      checkReleaseNudge(client, config.deployment, vault).catch(() => ({ hasNudge: false })),
      listQueuedChanges(db, businessId, session.user).catch(() => []),
    ]);
    release = relInfo;
    nudge = nudgeInfo;
    queuedChanges = changes;
  }

  return NextResponse.json({
    ok: true,
    ...settingsData,
    release,
    nudge,
    queuedChanges,
  });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();
  const client = getClient();

  if (body.action === "rename") {
    const res = await renameBusiness(db, session.user, businessId, body.name);
    return NextResponse.json(res);
  }

  if (body.action === "early-pay") {
    const res = await setEarlyPay(db, session.user, businessId, body.settings);
    return NextResponse.json(res);
  }

  if (body.action === "buffer-days") {
    const res = await setBufferDays(db, session.user, businessId, body.bufferDays);
    return NextResponse.json(res);
  }

  if (body.action === "prepare-schedule") {
    const res = await prepareScheduleUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
    );
    return NextResponse.json({ ok: true, ...res });
  }

  if (body.action === "record-schedule") {
    const txHash = body.txHash as Hex;
    const res = await recordScheduleUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
      txHash,
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare-cancel-upgrade") {
    const res = await prepareCancelUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
    );
    return NextResponse.json({ ok: true, ...res });
  }

  if (body.action === "record-cancel-upgrade") {
    const txHash = body.txHash as Hex;
    const res = await recordCancelUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
      txHash,
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare-upgrade") {
    const res = await prepareUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
    );
    return NextResponse.json({ ok: true, ...res });
  }

  if (body.action === "record-upgrade") {
    const txHash = body.txHash as Hex;
    const operationId = typeof body.operationId === "string" ? body.operationId : undefined;
    const res = await recordUpgrade(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
      txHash,
      operationId,
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare-auto-update") {
    const enabled = Boolean(body.enabled);
    const res = await prepareChange(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
      {
        kind: "set_auto_update",
        args: [enabled],
      },
    );
    return NextResponse.json(res);
  }

  if (body.action === "record-auto-update") {
    const txHash = body.txHash as Hex;
    const res = await recordChange(
      db,
      client,
      config.deployment,
      session.user,
      businessId,
      txHash,
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
});
