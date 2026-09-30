import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  loadPolicyView,
  preparePolicyChange,
  recordPolicyChange,
} from "@/lib/server/policy-edit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  const data = await loadPolicyView(db, getClient(), config.deployment, session.user, businessId);
  return NextResponse.json({ ok: true, ...data });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  if (body.action === "prepare") {
    const rawPolicy = body.policy as Record<string, unknown>;
    const nextPolicy = {
      perTxCap: BigInt(String(rawPolicy.perTxCap ?? 0)),
      autoPayLimit: BigInt(String(rawPolicy.autoPayLimit ?? 0)),
      ownerThreshold: BigInt(String(rawPolicy.ownerThreshold ?? 0)),
      newVendorMinPaid: Number(rawPolicy.newVendorMinPaid ?? 0),
      screeningMaxAge: BigInt(String(rawPolicy.screeningMaxAge ?? 0)),
      newPayeeDelay: BigInt(String(rawPolicy.newPayeeDelay ?? 0)),
      changeCooldown: BigInt(String(rawPolicy.changeCooldown ?? 0)),
      looseningDelay: BigInt(String(rawPolicy.looseningDelay ?? 0)),
      maxBridgeFee: BigInt(String(rawPolicy.maxBridgeFee ?? 0)),
    };

    const res = await preparePolicyChange(db, getClient(), config.deployment, session.user, businessId, nextPolicy);
    return NextResponse.json(res);
  }

  if (body.action === "record") {
    const txHash = body.txHash as Hex;
    const res = await recordPolicyChange(db, getClient(), config.deployment, session.user, businessId, txHash);
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
});
