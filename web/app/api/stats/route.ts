import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { protocolStatsCached } from "@/lib/server/stats";

export const dynamic = "force-dynamic";

/**
 * The network-wide numbers as JSON: only what the worker has already collected from Arc, with the network and block named.
 * No numbers while the history is still being collected. The worker moves that collection forward.
 */
export async function GET() {
  const cfg = getConfig();
  const db = await getDb();
  const client = getClient();
  const stats = await protocolStatsCached(db, client, cfg.deployment);
  return NextResponse.json(stats, { headers: { "cache-control": stats.state === "ready" ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store" } });
}
