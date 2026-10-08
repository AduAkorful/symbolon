import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * The check both scheduler routes share (plan 05zc §3). A scheduler holds `CRON_SECRET` and sends it as a bearer token: GitHub
 * Actions and cron services POST it, and Vercel Cron GETs with the same header. With no secret configured the routes are off, in
 * every build. Returns a response to send back when the call must not go on, or null when it is allowed.
 */
export function refuseUnlessScheduler(request: Request, what: string): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: `${what} is not configured.` }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  return null;
}
