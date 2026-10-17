import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";

import { formatAmount } from "@symbolon/seal";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { chainEvents, invoices, type Database, type decisions } from "@symbolon/db";

import { showMoney } from "../format";
import { isLendingReturn, summarizeDecision, type DecisionNow, type DecisionSummary } from "./decision-text";

type DecisionRow = typeof decisions.$inferSelect;

/** A lending move the Vault made, from its own event, keyed by the decision hash the event carries */
export interface LendingEvent {
  eventName: "LendingDeposited" | "LendingRedeemed";
  txHash: string;
  decisionHash: string | null;
  /** Raw USDC units moved, when the event says */
  assets: string | null;
}

export interface RecentDecision {
  row: DecisionRow;
  summary: DecisionSummary;
  /** Shown under the sentence instead of the record's kind when set ("Lending" for a move into or out of lending) */
  kindLabel: string | null;
  txHash: string | null;
}

const RETRY_WINDOW_MS = 30 * 60 * 1000;

const inputsOf = (row: DecisionRow) => (((row.record as { inputs?: Record<string, unknown> } | null)?.inputs ?? {}) as Record<string, unknown>);
const isPreparedMove = (row: DecisionRow) => (row.kind === "sweep" || row.kind === "redeem") && inputsOf(row).venue !== undefined && inputsOf(row).actor !== undefined;
const usdcText = (raw: string | null) => (raw && /^\d+$/.test(raw) ? showMoney(formatAmount(BigInt(raw), 6), "USDC") : "");

/**
 * The Steward page's "Recent decisions", told once each (QA retest 18):
 * - an owner's "Move cash in" / "Take cash out" writes a decision each time it is prepared, so a retried prepare listed "Prepared the
 *   lending move" twice. The one the Vault's event carries is the move: it reads "Moved $91.00 into the lending vault" with its
 *   transaction; an unsent prepare for the same move and amount within half an hour of it, or of a newer unsent one, is dropped;
 * - a redeem sends the cash back to the Vault with a token transfer, which the deposit reader recorded as "Added $91.00 to the Vault".
 *   It reads "Took $91.00 back from the lending vault", and is dropped when a decision above already shows that transaction.
 * Pure: everything it needs is passed in.
 */
export function foldRecentDecisions(rows: DecisionRow[], lending: LendingEvent[], now: DecisionNow = {}): RecentDecision[] {
  const byHash = new Map(lending.filter((e) => e.decisionHash).map((e) => [e.decisionHash!.toLowerCase(), e]));
  const lendingTxs = new Set(lending.map((e) => e.txHash.toLowerCase()));

  const prepared = rows.filter(isPreparedMove).map((row) => {
    const inputs = inputsOf(row);
    return { row, kind: row.kind, assets: String(inputs.assets ?? inputs.all ?? ""), at: row.createdAt.getTime(), sent: byHash.get(row.hash.toLowerCase()) ?? null };
  });
  const drop = new Set<string>();
  const sent = prepared.filter((p) => p.sent);
  const keptUnsent: typeof prepared = [];
  for (const p of prepared.filter((q) => !q.sent).sort((a, b) => b.at - a.at)) {
    const near = (q: (typeof prepared)[number]) => q.kind === p.kind && q.assets === p.assets && Math.abs(q.at - p.at) <= RETRY_WINDOW_MS;
    if (sent.some(near) || keptUnsent.some(near)) drop.add(p.row.id);
    else keptUnsent.push(p);
  }

  const out: RecentDecision[] = [];
  const shownTxs = new Set<string>();
  for (const row of rows) {
    if (drop.has(row.id)) continue;
    const record = row.record as Record<string, unknown>;
    const event = byHash.get(row.hash.toLowerCase()) ?? null;
    if (event && (row.kind === "sweep" || row.kind === "redeem")) {
      const amount = usdcText(event.assets ?? String(inputsOf(row).assets ?? ""));
      const base = summarizeDecision(record, now);
      // the Steward's own move says why; an owner's says what was done
      const why = isPreparedMove(row) || event.eventName === "LendingDeposited" ? "" : " ahead of upcoming bills";
      const sentence = event.eventName === "LendingDeposited"
        ? amount ? `Moved ${amount} into the lending vault` : "Moved cash into the lending vault"
        : `${amount ? `Took ${amount} back from the lending vault` : "Took cash back from the lending vault"}${why}`;
      out.push({ row, summary: { ...base, sentence }, kindLabel: "Lending", txHash: event.txHash });
      shownTxs.add(event.txHash.toLowerCase());
      continue;
    }
    if (row.kind === "deposit_confirmed") {
      const tx = (row.txHash ?? String(inputsOf(row).txHash ?? "")).toLowerCase();
      const fromLending = isLendingReturn(record, now.lendingVenues) || (tx !== "" && lendingTxs.has(tx));
      if (fromLending) {
        out.push({ row, summary: summarizeDecision({ ...record, inputs: { ...inputsOf(row), fromLending: true } }, now), kindLabel: "Lending", txHash: row.txHash });
        continue;
      }
    }
    out.push({ row, summary: summarizeDecision(record, now), kindLabel: null, txHash: row.txHash });
  }
  // rows arrive newest first, so a lending row for the same transaction may come after the deposit row: drop that deposit row
  return out.filter((d) => !(d.row.kind === "deposit_confirmed" && d.kindLabel === "Lending" && d.txHash && shownTxs.has(d.txHash.toLowerCase())));
}

/** The Vault's own lending events, for `foldRecentDecisions` */
export async function loadLendingEvents(db: Database, vault: string): Promise<LendingEvent[]> {
  const rows = await db
    .select({ eventName: chainEvents.eventName, txHash: chainEvents.txHash, args: chainEvents.args })
    .from(chainEvents)
    .where(and(eq(chainEvents.address, vault.toLowerCase()), inArray(chainEvents.eventName, ["LendingDeposited", "LendingRedeemed"])));
  return rows.map((r) => {
    const args = (r.args ?? {}) as Record<string, unknown>;
    return {
      eventName: r.eventName as LendingEvent["eventName"],
      txHash: r.txHash,
      decisionHash: typeof args.decisionHash === "string" ? args.decisionHash : null,
      assets: args.assets === undefined || args.assets === null ? null : String(args.assets),
    };
  });
}

/**
 * What a page needs to show stored decisions as they stand now: the lending vaults, and the currencies the Vault pays in (one read
 * per token). A read that fails leaves the token out, so a stored blocker is then shown as recorded, never cleared on a guess.
 */
export async function decisionNow(
  client: PublicClient,
  deployment: Deployment,
  vault: string,
  invoicesOf?: { db: Database; businessId: string },
): Promise<DecisionNow> {
  const lendingVenues = new Set((deployment.lendingVenues ?? []).map((v) => v.address.toLowerCase()));
  const supportedTokens = new Set<string>();
  try {
    const lens = symbolonContracts(client, deployment).lens.read;
    await Promise.all(
      [deployment.tokens.usdc, deployment.tokens.eurc].filter(Boolean).map(async (token) => {
        try {
          if (await lens.isSupportedToken([getAddress(vault), getAddress(token)])) supportedTokens.add(token.toLowerCase());
        } catch { /* unread stays unknown */ }
      }),
    );
  } catch { /* no lens: nothing is cleared */ }
  // each invoice's currency, so a decision about an EURC invoice says "€" (QA R25-2)
  const currencyBySubject = new Map<string, string>();
  if (invoicesOf) {
    const eurc = deployment.tokens.eurc?.toLowerCase();
    const rows = await invoicesOf.db.select({ fingerprint: invoices.fingerprint, token: invoices.token }).from(invoices).where(eq(invoices.businessId, invoicesOf.businessId));
    for (const r of rows) currencyBySubject.set(r.fingerprint.toLowerCase(), eurc && r.token.toLowerCase() === eurc ? "EURC" : "USDC");
  }
  return { lendingVenues, supportedTokens, currencyBySubject };
}
