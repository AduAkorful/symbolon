import "server-only";

import { eq } from "drizzle-orm";
import { getAddress, type Hex, type PublicClient } from "viem";

import { invoiceStatus, symbolonContracts } from "@symbolon/chain";
import { collectInvoiceHistory, type InvoiceHistory, type MirroredSettlement } from "@symbolon/core";
import { invoices, seals, type Database } from "@symbolon/db";
import { verifySealedInvoice, type InvoiceDocument } from "@symbolon/seal";

import type { ChainSettings } from "./business";
import { withDeadline } from "./deadline";

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

/** A visit waits this long for the payment records to be collected; the collection carries on after that, so the next visit has them */
export const RECEIPT_HISTORY_DEADLINE_MS = 12_000;

/** After a collection that could not finish, the same invoice is not searched again for this long (public pages are unauthenticated) */
const RETRY_AFTER_MS = 60_000;

const unconfirmedHistory = (fingerprint: string): PublicReceiptResult => ({
  state: "unconfirmed",
  fingerprint,
  reason: "Arc shows this invoice was paid, but the payment records are still being collected. Try again in a few minutes.",
});

const running = new Map<string, Promise<InvoiceHistory>>();
const gaveUp = new Map<string, number>();

/**
 * The invoice's payment events, from the database copy first and from the chain only for what the copy lacks (see
 * `collectInvoiceHistory`). One search per invoice at a time, whoever asks; a search that ended incomplete is not repeated
 * for a minute; a search that runs past the deadline keeps going and saves what it finds.
 */
async function historyFor(db: Database, client: PublicClient, cfg: ChainSettings, fingerprint: Hex, credited: bigint): Promise<InvoiceHistory | "late"> {
  const key = `${cfg.chainId}:${fingerprint}:${credited}`;
  const tried = gaveUp.get(key);
  if (tried !== undefined && Date.now() - tried < RETRY_AFTER_MS) return { complete: false, events: [], reason: "out_of_range" };
  let search = running.get(key);
  if (!search) {
    search = collectInvoiceHistory(db, client, cfg.deployment, fingerprint, credited).then(
      (result) => {
        if (!result.complete) gaveUp.set(key, Date.now());
        else gaveUp.delete(key);
        return result;
      },
    );
    running.set(key, search);
    const mine = search;
    const done = () => { if (running.get(key) === mine) running.delete(key); };
    mine.then(done, done);
  }
  try {
    return await withDeadline(search, RECEIPT_HISTORY_DEADLINE_MS, "Collecting the payment records");
  } catch {
    return "late";
  }
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

  // Settlements come from the database copy of the ledger's events; the chain is read only for what the copy lacks (plan
  // 05za, A2 and follow-up). The ledger's `credited` is the check: the settlements listed must add up to it.
  const history = await historyFor(db, client, cfg, fingerprint, onchainCredited);
  if (history === "late" || !history.complete) {
    if (history !== "late" && history.reason === "unreadable") {
      return { state: "unconfirmed", fingerprint, reason: "Can't confirm settlements from Arc right now. Try again shortly." };
    }
    return unconfirmedHistory(fingerprint);
  }
  const settledLogs: MirroredSettlement[] = history.events;

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
        txHash: l.txHash,
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
