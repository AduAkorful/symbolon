import { getAbiItem, type Address, type Hex, type PublicClient } from "viem";

import { verifySealedInvoice, type Verification } from "@symbolon/seal";

import type { SymbolonContracts } from "./contracts.js";
import type { Deployment } from "./deployment.js";
import { invoiceLedgerAbi } from "./generated/abis.js";
import { invoiceStatus, type InvoiceStatus } from "./reads.js";
import { scanLogs } from "./logs.js";

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
  if (!verification.fingerprint) return { verification, settlements: [] };
  const fp = verification.fingerprint;
  const status = await invoiceStatus(contracts, fp);
  if (!status.seen) return { verification, status, settlements: [] };

  const settled = getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" });
  const { logs } = await scanLogs(client, { address: deployment.contracts.invoiceLedger, events: [settled], fromBlock: deployment.startBlock });
  const mine = logs.filter((l) => l.args.fingerprint?.toLowerCase() === fp.toLowerCase());
  const settlements = await Promise.all(
    mine.map(async (l) => ({
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
      timestamp: (await client.getBlock({ blockNumber: l.blockNumber })).timestamp,
      payer: l.args.payer!,
      credit: l.args.credit!,
      paid: l.args.paid!,
      discountBps: l.args.discountBps!,
    })),
  );
  return { verification, status, settlements };
}
