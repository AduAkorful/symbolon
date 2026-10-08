import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { protocolStatsCached } from "@/lib/server/stats";

export const dynamic = "force-dynamic";

/** The network-wide numbers as JSON (plan 05zc §2): only what Arc shows, with the network and block named; null numbers while collecting */
export async function GET() {
  const cfg = getConfig();
  const stats = await protocolStatsCached(await getDb(), getClient(), cfg.deployment);
  return NextResponse.json(stats, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
