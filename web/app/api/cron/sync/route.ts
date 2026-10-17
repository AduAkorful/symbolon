import { NextResponse } from "next/server";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { refuseUnlessScheduler } from "@/lib/server/cron-auth";
import { releaseSyncLease, runCronSync, takeSyncLease } from "@/lib/server/cron-sync";
import { getDb } from "@/lib/server/db";

// Vercel stops the function here; the sync itself stops starting new reads at 50 s and answers by 95 s (see cron-sync.ts)
export const maxDuration = 120;

const asJson = (body: unknown, status = 200) =>
  new NextResponse(JSON.stringify(body, (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value)), {
    status,
    headers: { "content-type": "application/json" },
  });

async function run(request: Request) {
  const refused = refuseUnlessScheduler(request, "Ledger syncing");
  if (refused) return refused;
  const cfg = getConfig();
  const client = getClient();
  const db = await getDb();
  // one run at a time: monitors in several regions (or a manual check) calling together only slowed each other past the limit
  if (!(await takeSyncLease(db, cfg.chainId))) return asJson({ skipped: "another sync run is in progress", done: false });
  try {
    const report = await runCronSync(db, client, cfg);
    console.info("cron sync", JSON.stringify({ done: report.done, behindBlocks: report.behindBlocks.toString(), elapsedMs: report.elapsedMs, timings: report.timings }));
    // the ledger mirror failing outright is a real failure (as before); running out of time is progress, and the next run goes on
    const ledgerFailed = "ledgerError" in report && !/time limit/.test(report.ledgerError);
    return asJson(report, ledgerFailed ? 500 : 200);
  } finally {
    await releaseSyncLease(db, cfg.chainId).catch(() => {});
  }
}

// POST for an external scheduler (Better Stack monitors); GET because Vercel Cron only sends GET (same secret, same work)
export const POST = run;
export const GET = run;
