import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { prepareReservePolicy } from "@/lib/server/reserve-policy";
import { setBufferDays, setEarlyPay } from "@/lib/server/settings";
import {
  loadTreasury,
  prepareFund,
  prepareRedeem,
  prepareSubscribe,
  prepareWithdraw,
  recordConversion,
  recordReserveMove,
  recordWithdraw,
} from "@/lib/server/treasury";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();
  const client = getClient();

  const state = await loadTreasury(db, client, config.deployment, businessId, session.user);
  return NextResponse.json({ ok: true, state });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  switch (body.action) {
    case "prepare-withdraw": {
      const res = await prepareWithdraw(
        db,
        config,
        session.user,
        businessId,
        client,
        body.tokenSymbol === "EURC" ? "EURC" : "USDC",
        body.amount,
      );
      return NextResponse.json({ ok: true, ...res });
    }

    case "record-withdraw": {
      const res = await recordWithdraw(
        db,
        config,
        session.user,
        businessId,
        client,
        body.txHash,
        typeof body.reason === "string" ? body.reason : undefined,
      );
      return NextResponse.json(res);
    }

    case "prepare-fund": {
      const res = await prepareFund(
        db,
        config,
        session.user,
        businessId,
        body.amount,
        body.tokenSymbol === "EURC" ? "EURC" : "USDC",
      );
      return NextResponse.json({ ok: true, ...res });
    }

    case "prepare-reserve-policy": {
      const res = await prepareReservePolicy(db, client, config.deployment, session.user, businessId, {
        enabled: body.enabled === true,
        maxReservePercent: typeof body.maxReservePercent === "string" ? body.maxReservePercent : "",
        minOperating: typeof body.minOperating === "string" ? body.minOperating : "",
      });
      return NextResponse.json(res);
    }

    case "prepare-subscribe": {
      const res = await prepareSubscribe(
        db,
        config,
        session.user,
        businessId,
        client,
        body.assets,
        typeof body.slippageBps === "number" ? body.slippageBps : undefined,
      );
      return NextResponse.json({ ok: true, ...res });
    }

    case "prepare-redeem": {
      const res = await prepareRedeem(
        db,
        config,
        session.user,
        businessId,
        client,
        body.shares,
        typeof body.slippageBps === "number" ? body.slippageBps : undefined,
      );
      return NextResponse.json({ ok: true, ...res });
    }

    case "record-reserve": {
      const res = await recordReserveMove(
        db,
        config,
        session.user,
        businessId,
        client,
        body.txHash,
      );
      return NextResponse.json(res);
    }

    case "record-conversion": {
      const res = await recordConversion(
        db,
        config,
        session.user,
        businessId,
        client,
        body,
      );
      return NextResponse.json(res);
    }

    case "early-pay": {
      const res = await setEarlyPay(
        db,
        session.user,
        businessId,
        body.settings,
      );
      return NextResponse.json(res);
    }

    case "buffer": {
      const res = await setBufferDays(
        db,
        session.user,
        businessId,
        body.days,
      );
      return NextResponse.json(res);
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
});
