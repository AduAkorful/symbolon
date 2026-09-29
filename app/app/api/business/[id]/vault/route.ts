import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { confirmVault, prepareVault, prepareVaultSwitch, vaultStanding } from "@/lib/server/business";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { getStewardProvisioner } from "@/lib/server/steward-wallet";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "prepare" gives the exact call to sign (and makes the Steward's wallet); "record" confirms the Vault from its transaction and
 * saves it; "pause" and "resume" give the owner's call to stop or restart payments (plan 05h, H13–H14).
 */
export const POST = routeWith<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const s = await requireSession();
  const db = await getDb();
  const cfg = getConfig();
  if (body.action === "prepare") return NextResponse.json(await prepareVault(db, cfg, s.user, id, body.template, getStewardProvisioner()));
  if (body.action === "record") return NextResponse.json(await confirmVault(db, getClient(), cfg, s.user, id, body.txHash));
  if (body.action === "pause" || body.action === "resume") return NextResponse.json(await prepareVaultSwitch(db, cfg, s.user, id, body.action));
  throw new AuthError(400, "Unknown action.");
});

/** The Vault's Steward state as the chain shows it, for the owner (paused, active, or can't confirm). A GET: it reads only. */
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const s = await requireSession();
    return NextResponse.json(await vaultStanding(await getDb(), getClient(), getConfig(), s.user, id));
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("vault state failed", e);
    return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
  }
}
