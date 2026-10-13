import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { prepareFund, recordDeposit } from "@/lib/server/business";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import { requireMember } from "@/lib/server/access";
import { readVaultSummary } from "@/lib/server/vault-read";
import { readFundingMode } from "@/lib/server/vault-funding";
import { businesses } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { erc20Abi, getAddress } from "viem";

/** The call that moves USDC from the owner's wallet into the Vault. The balance itself is only ever read from the chain. */
export const POST = routeWith<{ params: Promise<{ id: string }> }>(async (request, ctx) => {
  const { id } = await ctx.params;
  const body = await readBody(request);
  const s = await requireSession();
  if (body.action === "record") return NextResponse.json(await recordDeposit(await getDb(), getClient(), getConfig(), s.user, id, body.txHash));
  return NextResponse.json(await prepareFund(await getDb(), getConfig(), s.user, id, body.amount));
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
  const client = getClient();
  const deployment = getConfig().deployment;
  const r = await readVaultSummary(client, deployment, b.vault);
  if (!r.ok) return NextResponse.json(r);
  // the signed-in wallet's own USDC at the same block, so a deposit can be checked against it; null when it can't be read
  const walletUsdc = s.user.wallet
    ? await client.readContract({ address: deployment.tokens.usdc, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(s.user.wallet)], blockNumber: r.block }).then((v) => v.toString(), () => null)
    : null;
  const funding = await readFundingMode(client, b.vault).catch(() => ({ walletSends: false, release: null }));
  const tokens = [
    { address: deployment.tokens.usdc, symbol: "USDC", decimals: 6 },
    { address: deployment.tokens.eurc, symbol: "EURC", decimals: 6 },
  ];
  return NextResponse.json({ ok: true, usdc: r.usdc.toString(), decimals: r.decimals, block: r.block.toString(), walletUsdc, funding, tokens });
}
