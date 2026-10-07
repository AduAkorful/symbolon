import { getAbiItem, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";

import type { Deployment } from "./deployment.js";
import { invoiceLedgerAbi } from "./generated/abis.js";
import { scanLogs } from "./logs.js";

/** One `Settled` event of the ledger, as the receipt and the verify page need it */
export interface SettledEvent {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  seal: Address;
  payer: Address;
  token: Address;
  credit: bigint;
  paid: bigint;
  discountBps: number;
  payoutDomain: number;
  payoutAddress: Address;
}

const settledAbi = getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" });

export const sumCredit = (events: readonly { credit: bigint }[]) => events.reduce((sum, e) => sum + e.credit, 0n);

export const settledKey = (e: { txHash: string; logIndex: number }) => `${e.txHash.toLowerCase()}:${e.logIndex}`;

function fromLog(l: {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  args: { seal?: Address; payer?: Address; token?: Address; credit?: bigint; paid?: bigint; discountBps?: number; payoutDomain?: number; payoutAddress?: Address };
}): SettledEvent {
  const a = l.args;
  return {
    txHash: l.transactionHash,
    logIndex: l.logIndex,
    blockNumber: l.blockNumber,
    seal: a.seal!,
    payer: a.payer!,
    token: a.token!,
    credit: a.credit!,
    paid: a.paid!,
    discountBps: Number(a.discountBps!),
    payoutDomain: Number(a.payoutDomain!),
    payoutAddress: a.payoutAddress!,
  };
}

/**
 * The invoice's `Settled` events inside the given transactions: one receipt read per transaction, no log search. For a
 * payment this app made itself the transaction hash is already on record, which makes this the cheapest way to find it.
 * A transaction that can't be read is skipped; the caller's credit check says whether what was found is enough.
 */
export async function settlementsInTransactions(
  client: PublicClient,
  deployment: Deployment,
  fingerprint: Hex,
  txHashes: readonly Hex[],
): Promise<SettledEvent[]> {
  const found = await Promise.all(
    [...new Set(txHashes.map((h) => h.toLowerCase() as Hex))].map(async (hash) => {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if (receipt.status !== "success") return [];
        const logs = parseEventLogs({ abi: invoiceLedgerAbi, eventName: "Settled", logs: receipt.logs, strict: true });
        return logs
          .filter((l) => l.address.toLowerCase() === deployment.contracts.invoiceLedger.toLowerCase() && l.args.fingerprint.toLowerCase() === fingerprint.toLowerCase())
          .map((l) => fromLog(l as never));
      } catch {
        return [];
      }
    }),
  );
  return found.flat();
}

export interface CollectOptions {
  fromBlock: bigint;
  toBlock: bigint;
  /** What the ledger says has been credited; reading stops as soon as the events found add up to it */
  credited: bigint;
  /** Events already known (from the stored copy); they count toward `credited` and are not returned again */
  have?: readonly SettledEvent[];
  /** Blocks read between completeness checks (default 100,000) */
  windowBlocks?: bigint;
  concurrency?: number;
  backoffMs?: number;
}

export interface Collected {
  /** New events only (not those passed in `have`) */
  events: SettledEvent[];
  /** Whether `have` plus `events` add up to `credited` */
  complete: boolean;
  /** Highest block read */
  scannedTo: bigint;
}

/**
 * Looks for an invoice's `Settled` events from `fromBlock` upward, filtered by the indexed fingerprint so the node returns
 * only this invoice's events, and stops at the first window where the events add up to what the ledger credited. Payments
 * come soon after an invoice is issued, so the search usually ends early. Throws if a range can't be read.
 */
export async function collectSettlements(client: PublicClient, deployment: Deployment, fingerprint: Hex, opts: CollectOptions): Promise<Collected> {
  const window = opts.windowBlocks ?? 100_000n;
  const seen = new Set((opts.have ?? []).map(settledKey));
  const events: SettledEvent[] = [];
  let total = sumCredit(opts.have ?? []);
  let scannedTo = opts.fromBlock - 1n;
  for (let from = opts.fromBlock; from <= opts.toBlock && total < opts.credited; from += window) {
    const to = from + window - 1n < opts.toBlock ? from + window - 1n : opts.toBlock;
    const { logs } = await scanLogs(client, {
      address: deployment.contracts.invoiceLedger,
      events: [settledAbi],
      args: { fingerprint },
      fromBlock: from,
      toBlock: to,
      concurrency: opts.concurrency ?? 2,
      ...(opts.backoffMs !== undefined ? { backoffMs: opts.backoffMs } : {}),
    });
    scannedTo = to;
    for (const log of logs) {
      // the node filters by fingerprint, but a mirror must never take that on trust
      if (log.args.fingerprint?.toLowerCase() !== fingerprint.toLowerCase()) continue;
      const event = fromLog(log as never);
      if (seen.has(settledKey(event))) continue;
      seen.add(settledKey(event));
      events.push(event);
      total += event.credit;
    }
  }
  return { events, complete: total === opts.credited, scannedTo };
}
