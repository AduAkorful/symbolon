import { NextResponse } from "next/server";
import { syncLedger } from "@symbolon/core";
import { symbolonContracts } from "@symbolon/chain";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { devSignInAllowed } from "@/lib/server/dev-signin";
import { getSession } from "@/lib/server/http";

export async function POST(request: Request) {
  const cfg = getConfig();
  const secret = process.env.CRON_SECRET?.trim();
  if (cfg.production && !secret) return NextResponse.json({ error: "Ledger syncing is not configured." }, { status: 503 });
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  if (!secret) {
    const session = await getSession();
    if (!devSignInAllowed(cfg) || !session || session.method !== "dev") return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const client = getClient();
  const report = await syncLedger(await getDb(), client, symbolonContracts(client, cfg.deployment), cfg.deployment);
  return new NextResponse(JSON.stringify(report, (_key: string, value: unknown) => typeof value === "bigint" ? value.toString() : value), { headers: { "content-type": "application/json" } });
}
