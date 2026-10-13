import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
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

/** A typed number that isn't one is the person's mistake (400), not our fault (500) */
function big(value: unknown, field: string): bigint {
  try {
    return BigInt(String(value ?? 0).trim() || "0");
  } catch {
    throw new AuthError(400, `That isn't a whole number (${field}).`);
  }
}

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  if (body.action === "prepare") {
    const rawPolicy = body.policy as Record<string, unknown>;
    const nextPolicy = {
      perTxCap: big(rawPolicy.perTxCap, "perTxCap"),
      autoPayLimit: big(rawPolicy.autoPayLimit, "autoPayLimit"),
      ownerThreshold: big(rawPolicy.ownerThreshold, "ownerThreshold"),
      newVendorMinPaid: Number(rawPolicy.newVendorMinPaid ?? 0),
      screeningMaxAge: big(rawPolicy.screeningMaxAge, "screeningMaxAge"),
      newPayeeDelay: big(rawPolicy.newPayeeDelay, "newPayeeDelay"),
      changeCooldown: big(rawPolicy.changeCooldown, "changeCooldown"),
      looseningDelay: big(rawPolicy.looseningDelay, "looseningDelay"),
      maxBridgeFee: big(rawPolicy.maxBridgeFee, "maxBridgeFee"),
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
