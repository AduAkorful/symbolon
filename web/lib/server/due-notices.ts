import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";
import { erc20Abi, getAddress, type PublicClient } from "viem";

import { notifyBusiness } from "@symbolon/core";
import { businesses, invoices, queuedChanges, type Database } from "@symbolon/db";
import { tokenShortfalls } from "@symbolon/steward";

import { formatAmount } from "@symbolon/seal";
import type { ChainSettings } from "./business";

const DAY = 86_400n;
/** The forecast window when the owner has not chosen one (the same default Treasury and Home use) */
const DEFAULT_BUFFER_DAYS = 30;

/**
 * Notices that are about time passing or a figure crossing a line, so no transaction rings them: noticed where time is already
 * looked at, a Steward run (plan 05zn). Each has a key that makes it once-only (a queued change, or a shortfall per
 * currency until its amount or first due date changes), so calling this on every run is harmless. A failure here is logged and never fails the run.
 */
export async function notifyDueNotices(db: Database, client: PublicClient, cfg: ChainSettings, businessId: string, now: Date = new Date()): Promise<void> {
  await queuedChangesReady(db, businessId, now).catch((e) => console.error("queued-change notices failed", e instanceof Error ? e.message : e));
  await shortfalls(db, client, cfg, businessId, now).catch((e) => console.error("shortfall notices failed", e instanceof Error ? e.message : e));
}

async function queuedChangesReady(db: Database, businessId: string, now: Date): Promise<void> {
  const ready = await db
    .select({ changeId: queuedChanges.changeId, kind: queuedChanges.kind, summary: queuedChanges.summary })
    .from(queuedChanges)
    .where(and(eq(queuedChanges.businessId, businessId), eq(queuedChanges.status, "queued"), lte(queuedChanges.eta, now)));
  for (const change of ready) {
    await notifyBusiness(db, businessId, {
      kind: "change_ready",
      subject: change.changeId,
      // the title says which change is ready, so the notice isn't generic (QA UI-24)
      body: { changeKind: change.kind, title: (change.summary as { title?: string } | null)?.title ?? "" },
      dedupeKey: `change_ready:${businessId}:${change.changeId}`,
    }, { roles: ["owner"] });
  }
}

async function shortfalls(db: Database, client: PublicClient, cfg: ChainSettings, businessId: string, now: Date): Promise<void> {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) return;
  const vault = getAddress(biz.vault);
  const tokens = [
    { symbol: "USDC", address: cfg.deployment.tokens.usdc.toLowerCase() },
    { symbol: "EURC", address: cfg.deployment.tokens.eurc.toLowerCase() },
  ];
  const balances = new Map<string, bigint>();
  for (const t of tokens) {
    // a balance that can't be read is skipped, never treated as zero: no notice is better than a false shortfall
    try {
      balances.set(t.address, await client.readContract({ address: getAddress(t.address), abi: erc20Abi, functionName: "balanceOf", args: [vault] }));
    } catch {
      /* skipped */
    }
  }
  if (balances.size === 0) return;
  const open = await db
    .select({ fingerprint: invoices.fingerprint, token: invoices.token, total: invoices.total, credited: invoices.credited, dueDate: invoices.dueDate })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), inArray(invoices.status, ["verified", "scheduled", "awaiting_approval", "held", "partially_paid"])));
  const nowSec = BigInt(Math.floor(now.getTime() / 1000));
  const flows = open
    .filter((i) => i.total > i.credited && balances.has(i.token.toLowerCase()))
    .map((i) => ({ at: BigInt(Math.floor(i.dueDate.getTime() / 1000)), amount: i.total - i.credited, direction: "out" as const, ref: i.fingerprint, token: i.token.toLowerCase() }));
  const dueAt = new Map(flows.map((f) => [f.ref, f.at]));
  for (const s of tokenShortfalls(balances, flows, nowSec, biz.bufferDays ?? DEFAULT_BUFFER_DAYS)) {
    const symbol = tokens.find((t) => t.address === s.token)?.symbol;
    if (!symbol) continue;
    const firstDue = s.refs.reduce<bigint | null>((m, r) => {
      const at = dueAt.get(r);
      return at === undefined ? m : m === null || at < m ? at : m;
    }, null);
    await notifyBusiness(db, businessId, {
      kind: "shortfall",
      subject: null,
      body: { symbol, short: `${formatAmount(s.short, 6)} ${symbol}`, due: `${formatAmount(s.due, 6)} ${symbol}` },
      dedupeKey: shortfallDedupeKey(businessId, symbol, s.short, firstDue),
    }, { roles: ["owner"] });
  }
}

/**
 * The once-only key for a shortfall notice (QA retest 17: the same "USDC may run short" rang every day while nothing changed). It
 * holds the amount short and the day the first bill in the window falls due, so the bell and Telegram ring again only when the
 * shortfall itself changes: a new bill, a payment, funds added, or a due date moved.
 */
export function shortfallDedupeKey(businessId: string, symbol: string, short: bigint, firstDueSec: bigint | null): string {
  const day = firstDueSec === null ? "none" : new Date(Number((firstDueSec / DAY) * DAY) * 1000).toISOString().slice(0, 10);
  // to the whole cent (6-decimal tokens, half up), so 572.393201 and 572.3932 are the same alert (QA R26-5)
  const cents = (short + 5_000n) / 10_000n;
  return `shortfall:${businessId}:${symbol}:${cents.toString()}c:${day}`;
}
