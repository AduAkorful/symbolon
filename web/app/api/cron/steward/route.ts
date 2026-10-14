import { isNotNull } from "drizzle-orm";
import { after, NextResponse } from "next/server";

import { businesses } from "@symbolon/db";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { refuseUnlessScheduler } from "@/lib/server/cron-auth";
import { getDb } from "@/lib/server/db";
import { runForBusiness } from "@/lib/server/steward-runtime";

export const maxDuration = 120;

const TIME_BUDGET_MS = 100_000;

async function run(request: Request) {
  const refused = refuseUnlessScheduler(request, "Scheduler");
  if (refused) return refused;

  const cfg = getConfig();
  const db = await getDb();
  const client = getClient();

  const all = await db.select({ id: businesses.id }).from(businesses).where(isNotNull(businesses.vault));

  // Answer at once and do the work after the response. A pass reads Arc many times and takes 30–100 s, and an uptime monitor gives
  // up on a response after 30 s, so it raised an incident on nearly every check (operator, 14 Oct). What each run did is stored in
  // `steward_runs` and shown on the Steward page; a run that fails there is the signal, not a slow HTTP answer.
  after(async () => {
    const startedAt = Date.now();
    for (const biz of all) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      try {
        await runForBusiness(db, client, cfg, biz.id, "schedule");
      } catch (err) {
        console.error("scheduled Steward run failed", biz.id, err instanceof Error ? err.message : err);
      }
    }
  });

  return NextResponse.json({ accepted: true, businesses: all.length }, { status: 202 });
}

// POST for an external scheduler (Better Stack monitors); GET because Vercel Cron only sends GET (same secret, same work)
export const POST = run;
export const GET = run;
