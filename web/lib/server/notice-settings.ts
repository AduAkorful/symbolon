import "server-only";
import { eq } from "drizzle-orm";
import { DELIVERABLE_KINDS, cleanPrefs, isDeliverableKind, kindEnabled, type DeliveryChannel, type NoticePrefs } from "@symbolon/core";
import { users, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import { listSubscriptions, pushConfig } from "./push";
import { createLinkCode, linkedChat, telegramConfig, unlinkChat } from "./telegram";

/** One switch on the Profile page: a kind, in words people use */
export const KIND_LABELS: Record<string, { label: string; group: string }> = {
  approval_needed: { label: "An invoice needs your approval", group: "Needs you" },
  invoice_held: { label: "An invoice was held", group: "Needs you" },
  shortfall: { label: "A currency may run short", group: "Needs you" },
  change_ready: { label: "A queued change is ready to apply", group: "Needs you" },
  steward_run_failed: { label: "A Steward run failed", group: "Needs you" },
  payment_sent: { label: "A payment was sent", group: "Payments" },
  money_moved: { label: "Money moved in or out of the Vault", group: "Payments" },
  invoice_paid: { label: "Your invoice was paid", group: "As a vendor" },
  invoice_declined: { label: "A business declined your invoice", group: "As a vendor" },
  invoice_reopened: { label: "A business reopened your invoice", group: "As a vendor" },
  invoice_cancelled: { label: "An invoice was cancelled", group: "As a vendor" },
  payee_active: { label: "You can be paid by a business now", group: "As a vendor" },
  offer_countered: { label: "Your Early Pay offer got a counter", group: "As a vendor" },
  payout_change_confirmed: { label: "Your payout address change was confirmed", group: "As a vendor" },
  payout_change_rejected: { label: "Your payout address change was rejected", group: "As a vendor" },
};

export interface NoticeSettingsView {
  kinds: { kind: string; label: string; group: string }[];
  telegram: { available: boolean; linked: boolean; master: boolean; enabled: Record<string, boolean>; botUsername: string | null };
  push: { available: boolean; publicKey: string | null; master: boolean; enabled: Record<string, boolean>; devices: { id: string; label: string | null }[] };
}

export async function loadNoticeSettings(db: Database, userId: string): Promise<NoticeSettingsView> {
  const [row] = await db.select({ prefs: users.noticePrefs }).from(users).where(eq(users.id, userId));
  const prefs = cleanPrefs(row?.prefs);
  const tg = telegramConfig();
  const pushCfg = pushConfig();
  const kinds = [...DELIVERABLE_KINDS.business, ...DELIVERABLE_KINDS.vendor].map((kind) => ({ kind, ...(KIND_LABELS[kind] ?? { label: kind, group: "Other" }) }));
  const enabledFor = (channel: DeliveryChannel) => Object.fromEntries(kinds.map((k) => [k.kind, kindEnabled(prefs, channel, k.kind)]));
  return {
    kinds,
    telegram: {
      available: tg !== null,
      linked: (await linkedChat(db, userId)) !== null,
      master: prefs.telegram?.master !== false,
      enabled: enabledFor("telegram"),
      botUsername: tg?.username ?? null,
    },
    push: {
      available: pushCfg !== null,
      publicKey: pushCfg?.publicKey ?? null,
      master: prefs.push?.master !== false,
      enabled: enabledFor("push"),
      devices: pushCfg ? (await listSubscriptions(db, userId)).map((d) => ({ id: d.id, label: d.label })) : [],
    },
  };
}

/** Sets one switch: the channel's master, or one kind. The stored JSON is cleaned first and written back whole. */
export async function setNoticePref(db: Database, userId: string, channel: DeliveryChannel, change: { master: boolean } | { kind: string; value: boolean }): Promise<void> {
  const [row] = await db.select({ prefs: users.noticePrefs }).from(users).where(eq(users.id, userId));
  const prefs: NoticePrefs = cleanPrefs(row?.prefs);
  const current = { ...(prefs[channel] ?? {}) };
  if ("master" in change) current.master = change.master;
  else {
    if (!isDeliverableKind(change.kind)) throw new AuthError(400, "That notice can't be sent outside the app.");
    current.kinds = { ...(current.kinds ?? {}), [change.kind]: change.value };
  }
  await db.update(users).set({ noticePrefs: { ...prefs, [channel]: current } }).where(eq(users.id, userId));
}

export async function startTelegramLink(db: Database, userId: string): Promise<string> {
  const tg = telegramConfig();
  if (!tg) throw new AuthError(409, "Telegram notices aren't switched on for this deployment.");
  const code = await createLinkCode(db, userId);
  return `https://t.me/${tg.username}?start=${code}`;
}

export const stopTelegram = (db: Database, userId: string) => unlinkChat(db, { userId });
