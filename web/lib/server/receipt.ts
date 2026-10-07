import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { getAbiItem, getAddress, type Hex, type PublicClient } from "viem";

import {
  invoiceLedgerAbi,
  invoiceStatus,
  scanLogs,
  symbolonContracts,
} from "@symbolon/chain";
import { chainEvents, invoices, seals, syncCursors, type Database } from "@symbolon/db";
import { verifySealedInvoice, type InvoiceDocument } from "@symbolon/seal";

import type { ChainSettings } from "./business";
import { syncKey } from "./sync";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export interface SettlementItem {
  txHash: string;
  blockNumber: string;
  timestamp: Date | null;
  payer: string;
  token: string;
  creditRaw: string;
  creditFormatted: string;
  paidRaw: string;
  paidFormatted: string;
  discountBps: number;
  discountSignedByVendor: boolean;
  payoutAddress: string;
  payoutDomain: number;
}

export type PublicReceiptResult =
  | {
      state: "settled";
      fingerprint: string;
      document: InvoiceDocument;
      invoiceNumber: string;
      vendor: {
        name: string;
        seal: string;
        handle: string | null;
        verifiedDomain: string | null;
      };
      settlements: SettlementItem[];
      totalPaidFormatted: string;
      totalCreditFormatted: string;
      isFullyPaid: boolean;
      isPartlyPaid: boolean;
      ledgerRemainingFormatted: string;
    }
  | {
      state: "unconfirmed";
      fingerprint: string;
      reason: string;
    };

/** How far behind the stored copy a live read may go. Beyond this the receipt says the history is still being collected. */
export const RECEIPT_TAIL_MAX_BLOCKS = 100_000n;

interface SettledRow {
  transactionHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTime: Date | null;
  payer: string;
  token: string | null;
  credit: bigint;
  paid: bigint;
  discountBps: number;
  payoutDomain: number;
  payoutAddress: string | null;
}

const sumCredit = (rows: SettledRow[]) => rows.reduce((sum, r) => sum + r.credit, 0n);

const unconfirmedHistory = (fingerprint: string): PublicReceiptResult => ({
  state: "unconfirmed",
  fingerprint,
  reason: "Arc shows this invoice was paid, but the payment records are still being collected. Try again in a few minutes.",
});

const big = (v: unknown) => (typeof v === "string" || typeof v === "bigint" || typeof v === "number" ? BigInt(v) : 0n);

/** The `Settled` events the app has already stored for this invoice (one indexed query, no chain calls) */
async function mirroredSettlements(db: Database, cfg: ChainSettings, fingerprint: Hex): Promise<SettledRow[]> {
  const rows = await db
    .select()
    .from(chainEvents)
    .where(
      and(
        eq(chainEvents.chainId, cfg.chainId),
        eq(chainEvents.address, cfg.deployment.contracts.invoiceLedger.toLowerCase()),
        eq(chainEvents.eventName, "Settled"),
        sql`lower(${chainEvents.args}->>'fingerprint') = ${fingerprint}`,
      ),
    )
    .orderBy(asc(chainEvents.blockNumber), asc(chainEvents.logIndex));
  return rows.map((r) => {
    const a = r.args as Record<string, unknown>;
    return {
      transactionHash: r.txHash,
      logIndex: r.logIndex,
      blockNumber: r.blockNumber,
      blockTime: r.blockTime,
      payer: String(a.payer ?? ""),
      token: a.token ? String(a.token) : null,
      credit: big(a.credit),
      paid: big(a.paid),
      discountBps: Number(a.discountBps ?? 0),
      payoutDomain: Number(a.payoutDomain ?? 0),
      payoutAddress: a.payoutAddress ? String(a.payoutAddress) : null,
    };
  });
}

/**
 * Reads the blocks after the stored copy's cursor straight from the chain. Returns null when the copy is further behind than
 * `RECEIPT_TAIL_MAX_BLOCKS`: a public page never turns into a scan of the whole history.
 */
async function recentSettlements(db: Database, client: PublicClient, cfg: ChainSettings, fingerprint: Hex): Promise<SettledRow[] | null> {
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, syncKey(cfg))).limit(1);
  const from = cursor ? cursor.block + 1n : cfg.deployment.startBlock;
  const head = await client.getBlockNumber();
  if (from > head) return [];
  if (head - from + 1n > RECEIPT_TAIL_MAX_BLOCKS) return null;
  const settledAbi = getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" });
  const { logs } = await scanLogs(client, {
    address: cfg.deployment.contracts.invoiceLedger,
    events: [settledAbi],
    fromBlock: from,
    toBlock: head,
    concurrency: 2,
  });
  return logs
    .filter((l) => l.args.fingerprint?.toLowerCase() === fingerprint)
    .map((l) => ({
      transactionHash: l.transactionHash.toLowerCase(),
      logIndex: l.logIndex,
      blockNumber: l.blockNumber,
      blockTime: null,
      payer: l.args.payer ?? "",
      token: l.args.token ?? null,
      credit: l.args.credit ?? 0n,
      paid: l.args.paid ?? 0n,
      discountBps: Number(l.args.discountBps ?? 0),
      payoutDomain: Number(l.args.payoutDomain ?? 0),
      payoutAddress: l.args.payoutAddress ?? null,
    }));
}

function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/**
 * Loads the public payment receipt for an invoice fingerprint (Decision A11).
 * Re-verifies the sealed invoice document and reads Settled logs live from the ledger.
 * Returns null (404) if invoice does not exist or has no settlements onchain.
 */
export async function loadReceipt(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  fingerprintValue: string,
): Promise<PublicReceiptResult | null> {
  if (!HASH_RE.test(fingerprintValue)) return null;
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.fingerprint, fingerprint))
    .limit(1);

  if (!row || row.status === "rejected") return null;

  const expected = { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger };
  const verification = await verifySealedInvoice(row.envelope, { client, expected });
  if (!verification.ok || !verification.document || !verification.invoice) {
    return {
      state: "unconfirmed",
      fingerprint,
      reason: "Invoice sealed document could not be verified against the ledger.",
    };
  }

  const doc = verification.document;
  const decimals = doc.currency?.decimals ?? 6;

  // The ledger's own count of what has been credited is the check on every settlement we list: the settlements must add up to it
  const contracts = symbolonContracts(client, cfg.deployment);
  let onchainRemaining = 0n;
  let onchainCredited = 0n;
  try {
    const status = await invoiceStatus(contracts, fingerprint);
    onchainRemaining = status.remaining;
    onchainCredited = status.credited;
  } catch {
    return { state: "unconfirmed", fingerprint, reason: "The ledger's balance for this invoice can't be confirmed right now. Try again shortly." };
  }
  // Decision A11: nothing credited -> 404
  if (onchainCredited === 0n) return null;

  // Settlements come from the database copy of the ledger's events, not from a scan of the chain's history on every visit
  // (plan 05za, A2). The copy is complete for this invoice when its credits add up to the ledger's `credited`; if not, the
  // recent blocks the copy hasn't reached yet are read live, within a bound.
  let settledLogs: SettledRow[] = await mirroredSettlements(db, cfg, fingerprint);
  if (sumCredit(settledLogs) !== onchainCredited) {
    try {
      const tail = await recentSettlements(db, client, cfg, fingerprint);
      if (tail === null) return unconfirmedHistory(fingerprint);
      const seen = new Set(settledLogs.map((l) => `${l.transactionHash}:${l.logIndex}`));
      settledLogs = [...settledLogs, ...tail.filter((l) => !seen.has(`${l.transactionHash}:${l.logIndex}`))];
    } catch (err) {
      console.error("Failed reading recent Settled logs for receipt:", err);
      return { state: "unconfirmed", fingerprint, reason: "Can't confirm settlements from Arc testnet right now. Try again shortly." };
    }
    if (sumCredit(settledLogs) !== onchainCredited) return unconfirmedHistory(fingerprint);
  }
  settledLogs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

  const settlements: SettlementItem[] = await Promise.all(
    settledLogs.map(async (l) => {
      let blockDate: Date | null = l.blockTime;
      if (!blockDate) {
        try {
          const block = await client.getBlock({ blockNumber: l.blockNumber });
          blockDate = new Date(Number(block.timestamp) * 1000);
        } catch {
          // The settlement log remains confirmed; its time is explicitly unavailable.
        }
      }

      return {
        txHash: l.transactionHash,
        blockNumber: String(l.blockNumber),
        timestamp: blockDate,
        payer: getAddress(l.payer),
        token: l.token ? getAddress(l.token) : doc.currency.token,
        creditRaw: l.credit.toString(),
        creditFormatted: formatAmount(l.credit, decimals),
        paidRaw: l.paid.toString(),
        paidFormatted: formatAmount(l.paid, decimals),
        discountBps: l.discountBps,
        discountSignedByVendor: l.discountBps > 0,
        payoutAddress: l.payoutAddress ? getAddress(l.payoutAddress) : doc.payout.address,
        payoutDomain: l.payoutDomain,
      };
    }),
  );

  let totalCredit = 0n;
  let totalPaid = 0n;
  for (const s of settlements) {
    totalCredit += BigInt(s.creditRaw);
    totalPaid += BigInt(s.paidRaw);
  }

  const isFullyPaid = onchainRemaining === 0n;
  const isPartlyPaid = totalPaid > 0n && !isFullyPaid;

  const [sealRow] = await db
    .select({ handle: seals.handle, verifiedDomain: seals.verifiedDomain })
    .from(seals)
    .where(eq(seals.address, doc.seal))
    .limit(1);

  return {
    state: "settled",
    fingerprint,
    document: doc,
    invoiceNumber: doc.invoiceNumber,
    vendor: {
      name: doc.vendor.name,
      seal: doc.seal,
      handle: sealRow?.handle ?? null,
      verifiedDomain: sealRow?.verifiedDomain ?? null,
    },
    settlements,
    totalPaidFormatted: formatAmount(totalPaid, decimals),
    totalCreditFormatted: formatAmount(totalCredit, decimals),
    isFullyPaid,
    isPartlyPaid,
    ledgerRemainingFormatted: formatAmount(onchainRemaining, decimals),
  };
}
