import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { AuthError } from "./errors";
import { getConfig } from "./config";
import { getDb } from "./db";
import { readSession, type SessionMethod, type SessionUser } from "./session";

// The Next-facing edge of sign-in: the cookie, the origin check, and turning errors into answers. Plan 05g, S1.

export const sessionCookieName = () => (getConfig().production ? "__Host-symbolon_session" : "symbolon_session");

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: getConfig().production,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(sessionCookieName(), "", { httpOnly: true, secure: getConfig().production, sameSite: "lax", path: "/", maxAge: 0 });
}

export interface CurrentSession {
  sessionId: string;
  method: SessionMethod;
  user: SessionUser;
}

/**
 * Who is signed in, or null. Never throws for a bad cookie: it just means signed out. Read once per request: the frame's streamed
 * parts ask again after the page has returned, and on a page that schedules work with `after()` Next refuses a second look at the
 * cookie ("used cookies() inside after() while rendering", found 2026-10-08 on the Inbox: no bell count, no pause control).
 */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return readSession(await getDb(), token);
});

/** For route handlers and server actions: 401 when signed out */
export async function requireSession(): Promise<CurrentSession> {
  const s = await getSession();
  if (!s) throw new AuthError(401, "You're signed out. Sign in to continue.");
  return s;
}

/** For pages: signed-out visitors go to sign-in and come back to where they were headed */
export async function requirePageSession(next?: string): Promise<CurrentSession> {
  const s = await getSession();
  if (!s) redirect(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin");
  return s;
}

/** A POST must come from this app's own pages: the Origin header has to equal the configured origin. */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("origin") !== getConfig().appOrigin) throw new AuthError(403, "That request didn't come from this app.");
}

/**
 * When a failure is only that Arc's public network could not answer in time (rate limit, every endpoint resting, a timeout), the
 * person is told that, in our own words: it is not our fault and trying again is the right thing to do. Fixed sentences only;
 * the error's own text (a library's, with versions and addresses) is never shown.
 */
export function arcBusyMessage(e: unknown): string | null {
  const parts: string[] = [];
  for (let err: unknown = e, depth = 0; err && depth < 4; err = (err as { cause?: unknown }).cause, depth++) {
    const o = err as { message?: unknown; details?: unknown };
    if (typeof o.message === "string") parts.push(o.message);
    if (typeof o.details === "string") parts.push(o.details);
  }
  const text = parts.join(" ");
  // only when it is Arc's pool or an RPC read that said so: another service's rate limit (the model's, say) is not Arc being busy
  if (/busy or resting/i.test(text) || (/\bRPC\b/i.test(text) && /rate limit|\b429\b|too many requests/i.test(text))) return "Arc's public network is busy right now. Try again in a moment.";
  if (/timed out|timeout|ETIMEDOUT/i.test(text) && /\bRPC\b|viem|fetch|request/i.test(text)) return "Arc took too long to answer. Try again in a moment.";
  return null;
}

/** Wraps a route handler with a context (the dynamic segments): origin-checked, and every failure becomes a plain JSON answer. Unknown errors are logged, never shown. */
export function routeWith<C>(handler: (request: Request, ctx: C) => Promise<Response>): (request: Request, ctx: C) => Promise<Response> {
  return async (request, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) assertSameOrigin(request);
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("route failed", e);
      const busy = arcBusyMessage(e);
      if (busy) return NextResponse.json({ error: busy }, { status: 503 });
      return NextResponse.json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
    }
  };
}

/** The same for a route with no dynamic segments */
export function route(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  const wrapped = routeWith<undefined>((request) => handler(request));
  return (request) => wrapped(request, undefined);
}

/** Reads a JSON body as a plain object, or a 400 */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AuthError(400, "That request was malformed.");
  return body as Record<string, unknown>;
}
