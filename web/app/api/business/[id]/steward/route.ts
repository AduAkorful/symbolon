import { NextResponse } from "next/server";
import { getAddress } from "viem";

import { symbolonContracts } from "@symbolon/chain";
import { shadowAgreement } from "@symbolon/core";
import { businesses } from "@symbolon/db";
import { eq } from "drizzle-orm";

import { requireMember } from "@/lib/server/access";
import { prepareFeeTransfer, recordFeeTransfer } from "@/lib/server/business";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { summarizeDecision } from "@/lib/server/decision-text";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { describePolicyLines } from "@/lib/server/policy-text";
import { rateLimit } from "@/lib/server/rate";
import { feeBalance, formatFeeBalance, lastRun, listRunDecisions, runForBusiness } from "@/lib/server/steward-runtime";
import { setMode } from "@/lib/server/steward-settings";
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 60;

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  await requireMember(db, session.user.id, businessId);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new AuthError(404, "Business not found.");

  const client = getClient();
  const config = getConfig();

  let standing = { kind: "none", ready: false, block: null as string | null, reason: null as string | null };
  let vaultState = null;
  let policyLines: string[] = [];

  if (biz.vault) {
    try {
      const vState = await readVaultState(client, config.deployment, biz.vault);
      vaultState = vState;
      const s = stewardStanding(biz.stewardWallet, vState);
      standing = {
        kind: s.kind,
        ready: s.kind === "paused" || s.kind === "active",
        block: "block" in s ? s.block.toString() : null,
        reason: s.kind === "unknown" ? s.reason : s.kind === "mismatch" ? "Vault steward does not match business record" : null,
      };
      if (vState.ok) {
        const contracts = symbolonContracts(client, config.deployment);
        const policy = await contracts.lens.read.getPolicy([getAddress(biz.vault)]);
        policyLines = describePolicyLines(policy);
      }
    } catch (err) {
      standing = { kind: "unknown", ready: false, block: null, reason: "Could not read Vault state from chain" };
    }
  }

  const rawFee = biz.stewardWallet ? await feeBalance(client, biz.stewardWallet) : null;
  const fee = formatFeeBalance(rawFee);

  const latestRun = await lastRun(db, businessId);
  const rawDecisions = await listRunDecisions(db, businessId, 25);
  const recentDecisions = rawDecisions.map((d) => ({
    id: d.id,
    kind: d.kind,
    subject: d.subject,
    txHash: d.txHash,
    createdAt: d.createdAt.toISOString(),
    summary: summarizeDecision(d.record as Record<string, unknown>),
  }));

  return NextResponse.json({
    business: {
      id: biz.id,
      name: biz.name,
      vault: biz.vault,
      stewardWallet: biz.stewardWallet,
      mode: biz.stewardMode,
      earlyPay: biz.earlyPay,
    },
    standing,
    fee,
    policyLines,
    lastRun: latestRun
      ? {
          id: latestRun.id,
          trigger: latestRun.trigger,
          mode: latestRun.mode,
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          summary: latestRun.summary,
          error: latestRun.error,
        }
      : null,
    recentDecisions,
    shadow: await shadowAgreement(db, businessId),
  });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  const action = body.action;

  if (action === "run") {
    await requireMember(db, session.user.id, businessId, "owner", "approver");
    rateLimit(`steward-run:${businessId}`, 1, 30_000, Date.now(), "Runs are limited to one every 30 seconds. Try again in a moment.");
    const run = await runForBusiness(db, client, config, businessId, "manual", session.user.id);
    return NextResponse.json({ ok: true, run });
  }

  if (action === "mode") {
    await requireMember(db, session.user.id, businessId, "owner");
    return NextResponse.json(await setMode(db, client, config, session.user, businessId, body.mode, Boolean(body.policyConfirmed)));
  }

  if (action === "prepare-fee" || action === "prepare_fee") {
    await requireMember(db, session.user.id, businessId, "owner");
    return NextResponse.json(await prepareFeeTransfer(db, config, session.user, businessId, body.amount));
  }

  if (action === "record-fee" || action === "record_fee") {
    await requireMember(db, session.user.id, businessId, "owner");
    return NextResponse.json(await recordFeeTransfer(db, client, config, session.user, businessId, body.txHash));
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
