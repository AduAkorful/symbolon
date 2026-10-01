import "server-only";
import { cookies } from "next/headers";
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

/** Who is signed in, or null. Never throws for a bad cookie: it just means signed out. */
export async function getSession(): Promise<CurrentSession | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  return readSession(await getDb(), token);
}

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

/** Wraps a route handler with a context (the dynamic segments): origin-checked, and every failure becomes a plain JSON answer. Unknown errors are logged, never shown. */
export function routeWith<C>(handler: (request: Request, ctx: C) => Promise<Response>): (request: Request, ctx: C) => Promise<Response> {
  return async (request, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) assertSameOrigin(request);
      return await handler(request, ctx);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("route failed", e);
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
