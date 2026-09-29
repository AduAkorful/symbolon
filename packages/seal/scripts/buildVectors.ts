import { getAddress, keccak256, stringToBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import {
  applyDiscount,
  canonicalDocument,
  completeTotals,
  digest,
  encodeSealedInvoice,
  sealDomain,
  sealInvoice,
  signSealMessage,
  structHash,
  typedData,
  type DocumentDraft,
  type Invoice,
  type SealDomain,
  type SealMessages,
  type SealPrimaryType,
} from "../src/index.js";

// Every address and key below is derived from a label the Solidity side derives identically
// (`keccak256("symbolon.vectors.<label>")`), so no value is typed by hand on either side.
export const label = (name: string): Hex => keccak256(stringToBytes(`symbolon.vectors.${name}`));
export const labelAddress = (name: string): Address => getAddress(`0x${label(name).slice(-40)}`);

/** Fixed clock for every vector (unix seconds), matching the Foundry fixtures */
export const VECTOR_NOW = 1_760_000_000;
const DAY = 86_400;
/** CCTP domain of Arc (plan 00 §1) and of a remote chain for the cross-chain vector */
const ARC_DOMAIN = 26;
const REMOTE_DOMAIN = 6;
const TOKEN_DECIMALS = 6;

const seal = privateKeyToAccount(label("seal"));
const approver = privateKeyToAccount(label("approver"));

const json = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));

function draft(overrides: Partial<DocumentDraft>): DocumentDraft {
  return {
    schema: "symbolon.invoice.v1",
    seal: seal.address.toLowerCase(),
    vendor: { name: "Vector Studio", email: "billing@vector.example" },
    payer: { name: "Vector Payer", email: "ap@payer.example" },
    invoiceNumber: "VEC-0001",
    issuedAt: VECTOR_NOW,
    dueDate: VECTOR_NOW + 30 * DAY,
    currency: { chainId: arcTestnet.id, token: labelAddress("token").toLowerCase(), symbol: "USDC", decimals: TOKEN_DECIMALS },
    lineItems: [{ description: "Design work", quantity: "7.5", unitPrice: "85.333333" }],
    taxes: [],
    discounts: [],
    payout: { address: labelAddress("payout").toLowerCase(), domain: ARC_DOMAIN },
    earlyPay: [],
    attachments: [],
    ...overrides,
  };
}

const drafts: Record<string, DocumentDraft> = {
  plain: draft({}),
  curve: draft({
    invoiceNumber: "VEC-0002",
    // non-ASCII text on purpose: the canonical bytes must be UTF-8 NFC on both sides
    vendor: { name: "Estúdio Ana", email: "ana@estudio.example", postalAddress: "Rua 1\nLisboa" },
    payer: { name: "Acme", vault: labelAddress("vault").toLowerCase() },
    lineItems: [
      { description: "Retainer — October", quantity: "1", unitPrice: "4000" },
      { description: "Extra hours", quantity: "12.25", unitPrice: "120.5" },
    ],
    taxes: [{ label: "VAT", rateBps: 2300 }],
    discounts: [{ label: "Loyalty", amount: "100" }],
    poNumber: "PO-2231",
    earlyPay: [
      { payBy: VECTOR_NOW + 3 * DAY, discountBps: 150 },
      { payBy: VECTOR_NOW + 15 * DAY, discountBps: 75 },
    ],
    attachments: [{ name: "timesheet.pdf", mediaType: "application/pdf", size: 18_234, hash: label("attachment") }],
    replaces: label("replaced"),
    terms: "Net 30",
  }),
  crossChain: draft({
    invoiceNumber: "VEC-0003",
    lineItems: [{ description: "Audit", quantity: "1", unitPrice: "2500" }],
    payout: { address: labelAddress("remotePayout").toLowerCase(), domain: REMOTE_DOMAIN },
  }),
};

function invoiceJson(invoice: Invoice) {
  return json({ ...invoice, earlyPayCount: invoice.earlyPay.length });
}

async function signed<T extends SealPrimaryType>(
  domain: SealDomain,
  signer: typeof seal,
  primaryType: T,
  message: SealMessages[T],
) {
  return {
    message: json(message),
    structHash: structHash(primaryType, message),
    digest: digest(domain, primaryType, message),
    signer: signer.address,
    signature: await signSealMessage(signer, typedData(domain, primaryType, message)),
  };
}

/** Builds the full vector set. Deterministic: RFC 6979 signatures, fixed labels, fixed clock. */
export async function buildVectors() {
  const ledger = labelAddress("ledger");
  const domain = sealDomain(arcTestnet.id, ledger);

  const invoices: Record<string, unknown> = {};
  const built: Record<string, { invoice: Invoice; fingerprint: Hex }> = {};
  for (const [name, d] of Object.entries(drafts)) {
    const document = completeTotals(d);
    const { sealed, invoice, fingerprint: fp } = await sealInvoice({ signer: seal, chainId: arcTestnet.id, ledger, document });
    built[name] = { invoice, fingerprint: fp };
    invoices[name] = {
      document: canonicalDocument(document),
      envelope: encodeSealedInvoice(sealed),
      invoice: invoiceJson(invoice),
      structHash: structHash("Invoice", invoice),
      fingerprint: fp,
      signature: sealed.signature,
    };
  }

  const curve = built.curve!;
  const plain = built.plain!;
  const offer = { fingerprint: curve.fingerprint, discountBps: 200, validUntil: BigInt(VECTOR_NOW + DAY) };

  const messages = {
    offer: await signed(domain, seal, "EarlyPayOffer", offer),
    cancel: await signed(domain, seal, "Cancel", { fingerprint: plain.fingerprint }),
    creditNote: await signed(domain, seal, "CreditNote", {
      fingerprint: plain.fingerprint,
      amount: 100_000_000n,
      documentHash: label("creditNoteDocument"),
      nonce: 1n,
    }),
    payoutChange: await signed(domain, seal, "PayoutChange", {
      seal: seal.address,
      newPayout: labelAddress("newPayout"),
      payoutDomain: ARC_DOMAIN,
      nonce: 7n,
    }),
    sealRotation: await signed(domain, seal, "SealRotation", { oldSeal: seal.address, newSeal: labelAddress("newSeal"), nonce: 2n }),
    approval: await signed(domain, approver, "Approval", {
      vault: labelAddress("vault"),
      fingerprint: curve.fingerprint,
      credit: curve.invoice.amount,
      deadline: BigInt(VECTOR_NOW + DAY),
    }),
  };

  // What the ledger must charge for each settlement; the Foundry test settles these with the TS signatures
  const maxFee = 1_000_000n;
  const settlements = [
    { invoice: "plain", discount: "none", tierIndex: 0, credit: plain.invoice.amount, maxFee: 0n, paid: plain.invoice.amount },
    { invoice: "curve", discount: "tier", tierIndex: 0, credit: curve.invoice.amount, maxFee: 0n, paid: applyDiscount(curve.invoice.amount, 150) },
    { invoice: "curve", discount: "offer", tierIndex: 0, credit: curve.invoice.amount, maxFee: 0n, paid: applyDiscount(curve.invoice.amount, offer.discountBps) },
    { invoice: "crossChain", discount: "none", tierIndex: 0, credit: built.crossChain!.invoice.amount, maxFee, paid: built.crossChain!.invoice.amount },
  ];

  return json({
    description: "Symbolon seal known vectors. Generated by `pnpm --filter @symbolon/seal vectors`; do not edit.",
    now: VECTOR_NOW,
    domain,
    // each address as derived from its label; the Foundry test re-derives and compares
    addresses: {
      ledger,
      token: labelAddress("token"),
      payout: labelAddress("payout"),
      remotePayout: labelAddress("remotePayout"),
      vault: labelAddress("vault"),
      seal: seal.address,
      approver: approver.address,
    },
    localDomain: ARC_DOMAIN,
    tokenDecimals: TOKEN_DECIMALS,
    invoices,
    messages,
    settlements,
  });
}
