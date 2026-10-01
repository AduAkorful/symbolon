import "server-only";

import { eq } from "drizzle-orm";
import { getAbiItem, getAddress, type Hex, type PublicClient } from "viem";

import {
  invoiceLedgerAbi,
  invoiceStatus,
  scanLogs,
  symbolonContracts,
} from "@symbolon/chain";
import { invoices, seals, type Database } from "@symbolon/db";
import { verifySealedInvoice, type InvoiceDocument } from "@symbolon/seal";

import type { ChainSettings } from "./business";

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

  // Scan Settled logs for this fingerprint
  let settledLogs: any[] = [];
  try {
    const settledAbi = getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" });
    const { logs } = await scanLogs(client, {
      address: cfg.deployment.contracts.invoiceLedger,
      events: [settledAbi],
      fromBlock: cfg.deployment.startBlock,
    });
    settledLogs = logs.filter(
      (l) => l.args.fingerprint && l.args.fingerprint.toLowerCase() === fingerprint,
    );
  } catch (err) {
    console.error("Failed scanning Settled logs for receipt:", err);
    return {
      state: "unconfirmed",
      fingerprint,
      reason: "Can't confirm settlements from Arc testnet right now. Try again shortly.",
    };
  }

  if (settledLogs.length === 0) {
    // Decision A11: No settlements -> 404
    return null;
  }

  const contracts = symbolonContracts(client, cfg.deployment);
  let onchainRemaining = 0n;
  try {
    const status = await invoiceStatus(contracts, fingerprint);
    onchainRemaining = status.remaining;
  } catch {
    return { state: "unconfirmed", fingerprint, reason: "Settlements exist, but the remaining invoice balance cannot be confirmed right now." };
  }

  const settlements: SettlementItem[] = await Promise.all(
    settledLogs.map(async (l) => {
      let blockDate: Date | null = null;
      try {
        if (l.blockNumber) {
          const block = await client.getBlock({ blockNumber: l.blockNumber });
          blockDate = new Date(Number(block.timestamp) * 1000);
        }
      } catch {
        // The settlement log remains confirmed; its time is explicitly unavailable.
      }

      const creditRaw = l.args.credit ?? 0n;
      const paidRaw = l.args.paid ?? 0n;
      const discountBps = Number(l.args.discountBps ?? 0);

      return {
        txHash: l.transactionHash,
        blockNumber: String(l.blockNumber ?? "0"),
        timestamp: blockDate,
        payer: getAddress(l.args.payer ?? "0x0000000000000000000000000000000000000000"),
        token: l.args.token ? getAddress(l.args.token) : doc.currency.token,
        creditRaw: creditRaw.toString(),
        creditFormatted: formatAmount(creditRaw, decimals),
        paidRaw: paidRaw.toString(),
        paidFormatted: formatAmount(paidRaw, decimals),
        discountBps,
        discountSignedByVendor: discountBps > 0,
        payoutAddress: l.args.payoutAddress ? getAddress(l.args.payoutAddress) : doc.payout.address,
        payoutDomain: Number(l.args.payoutDomain ?? 0),
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
      name: doc.vendor?.name ?? "Unknown vendor",
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
