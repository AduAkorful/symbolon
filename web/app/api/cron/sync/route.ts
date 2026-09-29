import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncLedger } from "@symbolon/core";
import { symbolonContracts } from "@symbolon/chain";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";

export async function POST(request: Request) {
  const cfg = getConfig();
  const secret = process.env.CRON_SECRET?.trim();
  // The route exists for a scheduler that holds the secret; with no secret configured it is off, in every build.
  if (!secret) return NextResponse.json({ error: "Ledger syncing is not configured." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const client = getClient();
  const report = await syncLedger(await getDb(), client, symbolonContracts(client, cfg.deployment), cfg.deployment);
  return new NextResponse(JSON.stringify(report, (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value), { headers: { "content-type": "application/json" } });
}
