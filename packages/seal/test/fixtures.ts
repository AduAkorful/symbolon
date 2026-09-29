import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { completeTotals, type InvoiceDocument } from "../src/index.js";
import { label, labelAddress, VECTOR_NOW } from "../scripts/buildVectors.js";

export const seal = privateKeyToAccount(label("seal"));
export const other = privateKeyToAccount(label("other"));
export const ledger = labelAddress("ledger");
export const chainId = arcTestnet.id;
export const NOW = VECTOR_NOW;
export const DAY = 86_400;

export function sampleDocument(): InvoiceDocument {
  return completeTotals({
    schema: "symbolon.invoice.v1",
    seal: seal.address.toLowerCase(),
    vendor: { name: "Studio Ana", email: "billing@ana.example" },
    payer: { name: "Acme", email: "ap@acme.example" },
    invoiceNumber: "INV-0142",
    issuedAt: NOW,
    dueDate: NOW + 30 * DAY,
    currency: { chainId, token: labelAddress("token").toLowerCase(), symbol: "USDC", decimals: 6 },
    lineItems: [
      { description: "Brand identity", quantity: "1", unitPrice: "3200" },
      { description: "Revisions", quantity: "4.5", unitPrice: "90" },
    ],
    taxes: [{ label: "VAT", rateBps: 2000 }],
    discounts: [],
    payout: { address: labelAddress("payout").toLowerCase(), domain: 26 },
    earlyPay: [
      { payBy: NOW + 3 * DAY, discountBps: 150 },
      { payBy: NOW + 15 * DAY, discountBps: 75 },
    ],
    attachments: [],
  });
}

/** A deep copy with one change applied, for tamper tests */
export function mutate(doc: InvoiceDocument, change: (d: Record<string, any>) => void): InvoiceDocument {
  const copy = structuredClone(doc) as Record<string, any>;
  change(copy);
  return copy as InvoiceDocument;
}
