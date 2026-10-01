import "server-only";

import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import type { SymbolonContracts } from "@symbolon/chain";
import { verifySealedInvoice, type Invoice } from "@symbolon/seal";
import type { ChainSettings } from "./business";
import { AuthError } from "./errors";

const ZERO32: Hex = `0x${"00".repeat(32)}`;

/** Only the verified signed document supplies an unseen invoice's payable amount (05p / audit F01). */
export async function verifyPaymentDocument(client: PublicClient, cfg: ChainSettings, envelope: string, fingerprint: Hex) {
  const result = await verifySealedInvoice(envelope, {
    client, expected: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
  });
  if (!result.ok || !result.invoice || !result.document || result.fingerprint?.toLowerCase() !== fingerprint) {
    throw new AuthError(400, "Invoice verification failed.");
  }
  return { invoice: result.invoice, document: result.document };
}

/** InvoiceLedger.remaining returns zero for unseen and cancelled fingerprints; status distinguishes them. */
export async function readPaymentLedger(contracts: SymbolonContracts, fingerprint: Hex, signedAmount: bigint) {
  const [state, remaining] = await Promise.all([
    contracts.ledger.read.status([fingerprint]), contracts.ledger.read.remaining([fingerprint]),
  ]).catch(() => { throw new AuthError(502, "Can't read invoice ledger state right now."); });
  return {
    cancelled: state.cancelled,
    settled: state.seen && remaining === 0n,
    credit: state.seen ? remaining : signedAmount,
    ledgerRemaining: state.cancelled ? 0n : state.seen ? remaining : undefined,
  };
}

/** The lens's isApprover includes operating grants; pass the actual invoice budget for scoped grants. */
export async function readPaymentBudget(contracts: SymbolonContracts, vault: Address, invoice: Invoice): Promise<Hex> {
  try {
    const payee = await contracts.lens.read.getPayee([vault, invoice.seal]);
    if (invoice.poRef !== ZERO32) {
      const po = await contracts.lens.read.getPurchaseOrder([vault, invoice.poRef]);
      if (po.seal.toLowerCase() !== zeroAddress) return po.budget;
    }
    return payee.terms.budget;
  } catch {
    throw new AuthError(502, "Can't read this invoice's payment budget right now.");
  }
}
