import { after, NextResponse } from "next/server";
import { syncProtocolEvents } from "@symbolon/core";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { protocolStatsCached } from "@/lib/server/stats";

export const dynamic = "force-dynamic";
// the background catch-up below runs after the response and counts against this
export const maxDuration = 120;

/** At most one catch-up per minute per instance, and never two at once: the scan is idempotent, this only keeps a busy page from piling them up */
let lastStarted = 0;
let running = false;

/**
 * The network-wide numbers as JSON (plan 05zc §2): only what Arc shows, with the network and block named; no numbers while the
 * history is still being collected. Asking while it is collecting also moves the collection one window forward (the scheduled
 * sync does the same), so a new deployment fills itself in even before a scheduler is switched on.
 */
export async function GET() {
  const cfg = getConfig();
  const db = await getDb();
  const client = getClient();
  const stats = await protocolStatsCached(db, client, cfg.deployment);
  if (stats.state === "collecting" && !running && Date.now() - lastStarted > 60_000) {
    lastStarted = Date.now();
    running = true;
    after(async () => {
      try {
        await syncProtocolEvents(db, client, cfg.deployment);
      } catch (error) {
        console.error("network history catch-up failed:", error instanceof Error ? error.message : error);
      } finally {
        running = false;
      }
    });
  }
  return NextResponse.json(stats, { headers: { "cache-control": stats.state === "ready" ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store" } });
}
