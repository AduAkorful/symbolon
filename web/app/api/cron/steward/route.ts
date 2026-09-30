import { timingSafeEqual } from "node:crypto";
import { isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { businesses } from "@symbolon/db";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { runForBusiness } from "@/lib/server/steward-runtime";

export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Scheduler is not configured." }, { status: 503 });
  }

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const cfg = getConfig();
  const db = await getDb();
  const client = getClient();

  const all = await db.select({ id: businesses.id }).from(businesses).where(isNotNull(businesses.vault));
  const results: { id: string; status: string; error?: string }[] = [];
  const startedAt = Date.now();

  for (const biz of all) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      results.push({ id: biz.id, status: "skipped_time_budget" });
      continue;
    }

    try {
      const run = await runForBusiness(db, client, cfg, biz.id, "schedule");
      results.push({ id: biz.id, status: run.status });
    } catch (err) {
      results.push({ id: biz.id, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    total: all.length,
    processed: results.length,
    businesses: results,
  });
}
