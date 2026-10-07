import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Hex, PublicClient } from "viem";

import {
  blockAtOrBefore,
  collectSettlements,
  settledKey,
  settlementsInTransactions,
  sumCredit,
  type Deployment,
  type SettledEvent,
} from "@symbolon/chain";
import { chainEvents, decisions, invoices, syncCursors, type Database } from "@symbolon/db";

import { storeEvents } from "./sync.js";

export interface HistoryLimits {
  /** Most blocks read after the stored copy's cursor (the newest part of the chain) */
  maxTailBlocks: bigint;
  /** Most blocks read upward from the invoice's start (the part the copy may have skipped); reading stops sooner once the payments add up */
  maxHistoryBlocks: bigint;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { maxTailBlocks: 100_000n, maxHistoryBlocks: 400_000n };

const ISSUE_MARGIN_SECONDS = 86_400n;

const big = (v: unknown) => (typeof v === "string" || typeof v === "bigint" || typeof v === "number" ? BigInt(v) : 0n);

/** A settlement as the mirror knows it; the block's time is empty until it has been looked up */
export type MirroredSettlement = SettledEvent & { blockTime: Date | null };

/** The `Settled` events the mirror holds for one invoice (one indexed query, no chain calls) */
export async function mirroredSettlements(db: Database, deployment: Deployment, fingerprint: Hex): Promise<MirroredSettlement[]> {
  const rows = await db
    .select()
    .from(chainEvents)
    .where(
      and(
        eq(chainEvents.chainId, deployment.chainId),
        eq(chainEvents.address, deployment.contracts.invoiceLedger.toLowerCase()),
        eq(chainEvents.eventName, "Settled"),
        sql`lower(${chainEvents.args}->>'fingerprint') = ${fingerprint.toLowerCase()}`,
      ),
    )
    .orderBy(asc(chainEvents.blockNumber), asc(chainEvents.logIndex));
  return rows.map((r) => {
    const a = r.args as Record<string, unknown>;
    return {
      txHash: r.txHash as Hex,
      logIndex: r.logIndex,
      blockNumber: r.blockNumber,
      blockTime: r.blockTime,
      seal: String(a.seal ?? "") as SettledEvent["seal"],
      payer: String(a.payer ?? "") as SettledEvent["payer"],
      token: String(a.token ?? "") as SettledEvent["token"],
      credit: big(a.credit),
      paid: big(a.paid),
      discountBps: Number(a.discountBps ?? 0),
      payoutDomain: Number(a.payoutDomain ?? 0),
      payoutAddress: String(a.payoutAddress ?? "") as SettledEvent["payoutAddress"],
    };
  });
}

export type InvoiceHistory =
  | { complete: true; events: MirroredSettlement[] }
  /** `reason`: the records the ledger counts could not all be found within the limits, or a read failed */
  | { complete: false; events: MirroredSettlement[]; reason: "out_of_range" | "unreadable" };

/**
 * Makes the mirror complete for one invoice, reading the chain only for what is missing. The ledger's own `credited` is
 * the check: the mirror is complete when its `Settled` credits add up to it. Otherwise, cheapest first:
 *   1. the transactions this app recorded for the invoice (one receipt each),
 *   2. the newest blocks after the mirror's cursor (fingerprint-filtered, bounded; skipped when the mirror is far behind),
 *   3. the blocks upward from the invoice's issue time (fingerprint-filtered, within a budget), stopping when it adds up.
 * Whatever is found is stored, so the next visit finds it in step 0. Never scans from the deployment's first block, and
 * never reports a partial history as complete.
 */
export async function collectInvoiceHistory(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  fingerprint: Hex,
  credited: bigint,
  limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
): Promise<InvoiceHistory> {
  fingerprint = fingerprint.toLowerCase() as Hex;
  let events = await mirroredSettlements(db, deployment, fingerprint);
  if (sumCredit(events) === credited) return { complete: true, events };

  const remember = async (found: SettledEvent[]) => {
    const have = new Set(events.map(settledKey));
    const fresh = found.filter((e) => !have.has(settledKey(e)));
    if (!fresh.length) return;
    await storeEvents(
      db,
      client,
      deployment.chainId,
      fresh.map((e) => ({
        transactionHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber,
        address: deployment.contracts.invoiceLedger,
        eventName: "Settled",
        args: { fingerprint, seal: e.seal, payer: e.payer, token: e.token, credit: e.credit, paid: e.paid, discountBps: e.discountBps, payoutDomain: e.payoutDomain, payoutAddress: e.payoutAddress },
      })),
    );
    events = [...events, ...fresh.map((e) => ({ ...e, blockTime: null }))].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  };

  try {
    // 1. our own payment transactions
    const recorded = await db
      .select({ txHash: decisions.txHash })
      .from(decisions)
      .where(and(eq(decisions.subject, fingerprint), isNotNull(decisions.txHash)))
      .orderBy(desc(decisions.createdAt))
      .limit(20);
    const hashes = recorded.map((r) => r.txHash as Hex);
    if (hashes.length) {
      await remember(await settlementsInTransactions(client, deployment, fingerprint, hashes));
      if (sumCredit(events) === credited) return { complete: true, events };
    }

    const head = await client.getBlockNumber();
    const key = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key)).limit(1);
    const cursorBlock = cursor?.block ?? null;

    // 2. after the cursor, when that stretch is short enough to read (a copy far behind is skipped here and covered by 3)
    let tailRead = false;
    if (cursorBlock !== null && cursorBlock < head && head - cursorBlock <= limits.maxTailBlocks) {
      const tail = await collectSettlements(client, deployment, fingerprint, { fromBlock: cursorBlock + 1n, toBlock: head, credited, have: events });
      await remember(tail.events);
      tailRead = true;
      if (sumCredit(events) === credited) return { complete: true, events };
    }

    // 3. from the invoice's own start up to the cursor (or to the head when the mirror has no cursor yet)
    const [invoice] = await db
      .select({ issuedAt: invoices.issuedAt, receivedAt: invoices.receivedAt })
      .from(invoices)
      .where(eq(invoices.fingerprint, fingerprint))
      .limit(1);
    const startedAt = invoice ? new Date(Math.min(...[invoice.issuedAt, invoice.receivedAt].filter((d): d is Date => d != null).map((d) => d.getTime()))) : null;
    const upTo = tailRead && cursorBlock !== null ? cursorBlock : head;
    const first = startedAt
      ? await blockAtOrBefore(client, BigInt(Math.floor(startedAt.getTime() / 1000)) - ISSUE_MARGIN_SECONDS, { lo: deployment.startBlock, hi: head })
      : deployment.startBlock;
    // read upward from the invoice's start, no further than the budget: a payment comes soon after an invoice is issued
    const last = upTo < first + limits.maxHistoryBlocks - 1n ? upTo : first + limits.maxHistoryBlocks - 1n;
    if (first <= last) {
      const past = await collectSettlements(client, deployment, fingerprint, { fromBlock: first, toBlock: last, credited, have: events });
      await remember(past.events);
    }
  } catch (error) {
    console.error("reading an invoice's payment history failed", error);
    return { complete: false, events, reason: "unreadable" };
  }
  return sumCredit(events) === credited ? { complete: true, events } : { complete: false, events, reason: "out_of_range" };
}
