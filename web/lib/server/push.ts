import "server-only";
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { pushSubscriptions, type Database } from "@symbolon/db";
import { AuthError } from "./errors";

/** Web push delivery of notices (plan 05zr 4a). Off unless both VAPID keys are present. */
export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // the subject is the app's own https origin, so the push services can reach whoever runs it
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || env.APP_ORIGIN?.trim() || "https://localhost" };
}

export const MAX_DEVICES = 10;

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** An endpoint is a push service's https URL; anything else is refused before it is stored */
function validSubscription(sub: unknown): sub is BrowserSubscription {
  if (!sub || typeof sub !== "object") return false;
  const s = sub as BrowserSubscription;
  if (typeof s.endpoint !== "string" || s.endpoint.length > 1000) return false;
  try {
    if (new URL(s.endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string" && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

export async function saveSubscription(db: Database, userId: string, sub: unknown, label: unknown): Promise<void> {
  if (!pushConfig()) throw new AuthError(409, "Push notices aren't switched on for this deployment.");
  if (!validSubscription(sub)) throw new AuthError(400, "That device's subscription wasn't valid.");
  const mine = await db.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!mine.some((m) => m.endpoint === sub.endpoint) && mine.length >= MAX_DEVICES) throw new AuthError(409, "You've reached the limit of devices. Remove one first.");
  const name = typeof label === "string" ? label.trim().slice(0, 60) : "";
  // a device re-subscribing (or another account on the same browser) takes over its endpoint
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: name || null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, label: name || null } });
}

export async function removeSubscription(db: Database, userId: string, id: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)));
}

export async function listSubscriptions(db: Database, userId: string) {
  return db
    .select({ id: pushSubscriptions.id, label: pushSubscriptions.label, createdAt: pushSubscriptions.createdAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

export type PushResult = "sent" | "gone" | "failed";

/** Payload is title, body and a same-origin path only: the text the bell already shows. */
export async function sendPush(cfg: PushConfig, sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; href?: string }): Promise<PushResult> {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
      TTL: 60 * 60 * 24,
      timeout: 5000,
    });
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}
