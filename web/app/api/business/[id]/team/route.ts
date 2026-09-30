import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  listTeamMembers,
  prepareOnchainRole,
  recordOnchainRole,
  removeMember,
  setMemberRole,
} from "@/lib/server/team";
import {
  createTeamInvitation,
  listTeamInvitations,
  revokeTeamInvitation,
} from "@/lib/server/team-invitations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = routeWith<Ctx>(async (_request, ctx) => {
  const { id: businessId } = await ctx.params;
  const session = await requireSession();
  const db = await getDb();
  const config = getConfig();

  const [teamData, invitations] = await Promise.all([
    listTeamMembers(db, getClient(), config.deployment, session.user, businessId),
    listTeamInvitations(db, session.user, businessId),
  ]);

  return NextResponse.json({
    ok: true,
    ...teamData,
    invitations,
  });
});

export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id: businessId } = await ctx.params;
  const body = await readBody(request);
  const session = await requireSession();
  const config = getConfig();
  const db = await getDb();

  if (body.action === "invite") {
    const origin = new URL(request.url).origin;
    const res = await createTeamInvitation(
      db,
      session.user,
      businessId,
      {
        role: body.role,
        budgets: body.budgets,
        label: body.label,
      },
      origin,
    );
    return NextResponse.json({ ok: true, invitation: res });
  }

  if (body.action === "revoke-invite") {
    const res = await revokeTeamInvitation(
      db,
      session.user,
      businessId,
      String(body.invitationId),
    );
    return NextResponse.json(res);
  }

  if (body.action === "set-role") {
    const res = await setMemberRole(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      String(body.targetUserId),
      body.newRole as any,
      body.budgets as any,
    );
    return NextResponse.json(res);
  }

  if (body.action === "remove") {
    const res = await removeMember(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      String(body.targetUserId),
    );
    return NextResponse.json(res);
  }

  if (body.action === "prepare-onchain") {
    const res = await prepareOnchainRole(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      {
        targetUserId: String(body.targetUserId),
        role: body.role as "approver" | "requester",
        enabled: Boolean(body.enabled),
        budgetId: body.budgetId ? String(body.budgetId) : undefined,
      },
    );
    return NextResponse.json(res);
  }

  if (body.action === "record-onchain") {
    const res = await recordOnchainRole(
      db,
      getClient(),
      config.deployment,
      session.user,
      businessId,
      body.txHash as Hex,
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
});
