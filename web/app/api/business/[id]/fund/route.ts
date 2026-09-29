import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { prepareFund } from "@/lib/server/business";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { requireMember } from "@/lib/server/access";
import { readVaultSummary } from "@/lib/server/vault-read";
import { businesses } from "@symbolon/db";
import { eq } from "drizzle-orm";

/** The call that moves USDC from the owner's wallet into the Vault. The balance itself is only ever read from the chain. */
export const POST = routeWith<{ params: Promise<{ id: string }> }>(async (request, ctx) => {
  const { id } = await ctx.params;
  const { amount } = await readBody(request);
  const s = await requireSession();
  return NextResponse.json(await prepareFund(await getDb(), getConfig(), s.user, id, amount));
});

/** The Vault's USDC balance, read live. Answers with the failure, never a made-up number. (A GET: it reads only.) */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await requireSession().catch(() => null);
  if (!s) return NextResponse.json({ error: "You're signed out." }, { status: 401 });
  const db = await getDb();
  try {
    await requireMember(db, s.user.id, id);
  } catch {
    return NextResponse.json({ error: "You don't have access to this business." }, { status: 403 });
  }
  const [b] = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  if (!b?.vault) return NextResponse.json({ error: "No Vault yet." }, { status: 409 });
  const r = await readVaultSummary(getClient(), getConfig().deployment, b.vault);
  return NextResponse.json(r.ok ? { ok: true, usdc: r.usdc.toString(), decimals: r.decimals, block: r.block.toString() } : r);
}
