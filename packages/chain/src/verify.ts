import type { Address, Hex, PublicClient } from "viem";

import { verifySealedInvoice, type Verification } from "@symbolon/seal";

import type { SymbolonContracts } from "./contracts.js";
import type { Deployment } from "./deployment.js";
import { blockAtOrBefore } from "./blocks.js";
import { invoiceStatus, type InvoiceStatus } from "./reads.js";
import { collectSettlements, type SettledEvent } from "./settlements.js";

/** An invoice is not paid before it is issued; a day of margin covers clock differences and a date-only issue time */
const ISSUE_MARGIN_SECONDS = 86_400n;

export interface Settlement {
  txHash: Hex;
  blockNumber: bigint;
  timestamp: bigint;
  payer: Address;
  credit: bigint;
  paid: bigint;
  discountBps: number;
}

export interface InvoiceCheck {
  verification: Verification;
  /** Ledger state, when the envelope was genuine enough to have a fingerprint */
  status?: InvoiceStatus;
  settlements: Settlement[];
  /**
   * Whether the settlements listed add up to what the ledger says was credited. False means the invoice is paid but its
   * payment records could not all be read; the page must say so rather than list a partial history as the whole.
   */
  settlementsComplete: boolean;
}

/**
 * Everything the public verify page shows (spec §11.4): is this file genuinely sealed by this vendor, has it been
 * modified, has it been paid and when. Runs in the browser against a public RPC; nothing is uploaded.
 */
export async function checkInvoice(
  client: PublicClient,
  contracts: SymbolonContracts,
  deployment: Deployment,
  envelope: string | unknown,
): Promise<InvoiceCheck> {
  const verification = await verifySealedInvoice(envelope, {
    client,
    expected: { chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger },
  });
  if (!verification.fingerprint) return { verification, settlements: [], settlementsComplete: true };
  const fp = verification.fingerprint;
  const status = await invoiceStatus(contracts, fp);
  if (!status.seen) return { verification, status, settlements: [], settlementsComplete: true };

  // Nothing credited means nothing settled: no need to read the history at all
  if (status.credited === 0n) return { verification, status, settlements: [], settlementsComplete: true };

  // Payments come after the invoice exists, so the search starts at its issue time, not at the ledger's first block, and
  // stops as soon as the events found add up to what the ledger credited.
  const head = await client.getBlockNumber();
  const issuedAt = verification.invoice?.issuedAt;
  const first = issuedAt === undefined ? deployment.startBlock : await blockAtOrBefore(client, issuedAt - ISSUE_MARGIN_SECONDS, { lo: deployment.startBlock, hi: head });
  const found = await collectSettlements(client, deployment, fp, { fromBlock: first, toBlock: head, credited: status.credited });
  let events: SettledEvent[] = found.events;
  let complete = found.complete;
  if (!complete && first > deployment.startBlock) {
    // an invoice dated after its own payment is odd but possible; only then is the earlier history worth reading
    const earlier = await collectSettlements(client, deployment, fp, { fromBlock: deployment.startBlock, toBlock: first - 1n, credited: status.credited, have: events });
    events = [...earlier.events, ...events];
    complete = earlier.complete;
  }
  const settlements = await Promise.all(
    events.map(async (e) => ({
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      timestamp: (await client.getBlock({ blockNumber: e.blockNumber })).timestamp,
      payer: e.payer,
      credit: e.credit,
      paid: e.paid,
      discountBps: e.discountBps,
    })),
  );
  return { verification, status, settlements, settlementsComplete: complete };
}
