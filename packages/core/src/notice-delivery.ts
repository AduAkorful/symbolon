/**
 * Delivery of notices outside the app (plan 05zr): the policy that decides whether a stored notice is mirrored to a channel,
 * and the listener hook the app registers so `notify*` can hand it new ids without this package knowing about Telegram,
 * push services or secrets. The bell (the `notifications` row) is always the source of truth; a channel is only a mirror.
 */

export type DeliveryChannel = "telegram" | "push";

/** The only kinds a person can choose to receive off-app. Anything else stays in the bell. */
export const DELIVERABLE_KINDS = {
  business: ["approval_needed", "invoice_held", "shortfall", "change_ready", "steward_run_failed", "payment_sent", "money_moved"],
  vendor: [
    "invoice_paid",
    "invoice_declined",
    "invoice_reopened",
    "invoice_cancelled",
    "payee_active",
    "offer_countered",
    "payout_change_confirmed",
    "payout_change_rejected",
  ],
} as const;

const ALL_KINDS: readonly string[] = [...DELIVERABLE_KINDS.business, ...DELIVERABLE_KINDS.vendor];
const VENDOR_KINDS: readonly string[] = DELIVERABLE_KINDS.vendor;

export const isDeliverableKind = (kind: string): boolean => ALL_KINDS.includes(kind);

/** Per channel: a master switch and per-kind switches. A missing entry means "the default for that kind". */
export interface ChannelPrefs {
  master?: boolean;
  kinds?: Record<string, boolean>;
}
export type NoticePrefs = Partial<Record<DeliveryChannel, ChannelPrefs>>;

/** Owner/approver kinds are on once a channel is connected; vendor kinds stay off until the person turns them on (operator, 2026-10-14). */
export function kindEnabled(prefs: NoticePrefs | null | undefined, channel: DeliveryChannel, kind: string): boolean {
  if (!isDeliverableKind(kind)) return false;
  const channelPrefs = prefs?.[channel];
  if (channelPrefs?.master === false) return false;
  const chosen = channelPrefs?.kinds?.[kind];
  if (typeof chosen === "boolean") return chosen;
  return !VENDOR_KINDS.includes(kind);
}

/** At most this many off-app messages per person per hour, over all channels together; extras stay in the bell. */
export const MAX_DELIVERIES_PER_HOUR = 20;

export function withinRateGuard(sentLastHour: number): boolean {
  return sentLastHour < MAX_DELIVERIES_PER_HOUR;
}

/** Keeps only well-formed preferences from stored JSON (a hand-edited or old value never throws). */
export function cleanPrefs(raw: unknown): NoticePrefs {
  const out: NoticePrefs = {};
  if (!raw || typeof raw !== "object") return out;
  for (const channel of ["telegram", "push"] as const) {
    const c = (raw as Record<string, unknown>)[channel];
    if (!c || typeof c !== "object") continue;
    const entry: ChannelPrefs = {};
    const master = (c as Record<string, unknown>).master;
    if (typeof master === "boolean") entry.master = master;
    const kinds = (c as Record<string, unknown>).kinds;
    if (kinds && typeof kinds === "object") {
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(kinds as Record<string, unknown>)) if (isDeliverableKind(k) && typeof v === "boolean") clean[k] = v;
      entry.kinds = clean;
    }
    out[channel] = entry;
  }
  return out;
}

// ─── the hook ────────────────────────────────────────────────────────────────

export type NoticeListener = (ids: string[]) => Promise<void>;
const KEY = Symbol.for("symbolon.noticeListener");
type Holder = { [KEY]?: NoticeListener };

/** The app registers one listener at start. Held on globalThis so a bundler giving two module copies still shares it. */
export function setNoticeListener(listener: NoticeListener | null): void {
  const holder = globalThis as unknown as Holder;
  if (listener) holder[KEY] = listener;
  else delete holder[KEY];
}

/** Called by `notify*` with the ids of rows that were newly inserted. Never throws: delivery can't fail a notice. */
export async function emitInserted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const listener = (globalThis as unknown as Holder)[KEY];
  if (!listener) return;
  try {
    await listener(ids);
  } catch (e) {
    console.error("notice delivery failed", e instanceof Error ? e.message : "unknown");
  }
}
