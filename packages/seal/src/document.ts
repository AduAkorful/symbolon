import { keccak256, pad, stringToBytes, type Address, type Hex } from "viem";
import { z } from "zod";

import {
  formatAmount,
  formatQuantity,
  isCanonicalAmount,
  isCanonicalQuantity,
  lineAmount,
  parseAmount,
  parseQuantity,
  divRoundHalfUp,
} from "./amount.js";
import { canonicalJson } from "./canonical.js";
import { BPS_DENOMINATOR, DOCUMENT_SCHEMA, MAX_DISCOUNT_BPS, ZERO_BYTES32 } from "./constants.js";
import { SealError, type Issue } from "./errors.js";
import type { Invoice } from "./typedData.js";

// ---------------------------------------------------------------------------------------------------------------------
// Field rules. The document is a security boundary: the browser, the Steward and the verify page must all hash the
// same bytes, and a human must see the same text the Seal signed. So text is NFC, free of control and bidi-override
// characters (which can make rendered text differ from its bytes), and trimmed; nothing is silently normalised here.
// ---------------------------------------------------------------------------------------------------------------------

const MAX_UINT32 = 2 ** 32 - 1;
const CONTROL = /\p{Cc}/u;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/u;
const BIDI_AND_SEPARATORS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/u;

function textRule(multiline: boolean) {
  return (s: string): boolean =>
    s.isWellFormed() &&
    s === s.normalize("NFC") &&
    s === s.trim() &&
    !(multiline ? CONTROL_EXCEPT_NEWLINE : CONTROL).test(s) &&
    !BIDI_AND_SEPARATORS.test(s);
}

const line = (max: number) =>
  z.string().min(1).max(max).refine(textRule(false), "must be trimmed NFC text without control or bidi characters");
const block = (max: number) =>
  z.string().min(1).max(max).refine(textRule(true), "must be trimmed NFC text without control or bidi characters");
const address = z.string().regex(/^0x[0-9a-f]{40}$/, "must be a lowercase 0x address");
const bytes32 = z.string().regex(/^0x[0-9a-f]{64}$/, "must be lowercase 0x-prefixed 32 bytes");
const email = z.string().max(254).regex(/^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$/, "must be a lowercase email address");
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const decimalString = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/, "must be a plain decimal string");

const party = {
  name: line(200),
  legalName: line(200).optional(),
  email: email.optional(),
  taxId: line(100).optional(),
  postalAddress: block(500).optional(),
};

export const invoiceDocumentSchema = z
  .strictObject({
    schema: z.literal(DOCUMENT_SCHEMA),
    seal: address,
    vendor: z.strictObject({ ...party, website: line(200).optional() }),
    payer: z
      .strictObject({ ...party, vault: address.optional() })
      .refine((p) => p.vault !== undefined || p.email !== undefined, "needs a vault address or an email"),
    invoiceNumber: line(100),
    issuedAt: timestamp,
    dueDate: timestamp,
    currency: z.strictObject({
      chainId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      token: address,
      symbol: line(16),
      decimals: z.number().int().min(0).max(18),
    }),
    lineItems: z
      .array(z.strictObject({ description: block(1000), quantity: decimalString, unitPrice: decimalString, amount: decimalString }))
      .min(1)
      .max(500),
    taxes: z.array(z.strictObject({ label: line(100), rateBps: z.number().int().min(0).max(10_000).optional(), amount: decimalString })).max(20),
    discounts: z.array(z.strictObject({ label: line(100), amount: decimalString })).max(20),
    subtotal: decimalString,
    total: decimalString,
    poNumber: line(100).optional(),
    terms: block(2000).optional(),
    notes: block(4000).optional(),
    payout: z.strictObject({ address, domain: z.number().int().min(0).max(MAX_UINT32) }),
    earlyPay: z.array(z.strictObject({ payBy: timestamp, discountBps: z.number().int().min(0).max(10_000) })).max(8),
    attachments: z
      .array(z.strictObject({ name: line(200), mediaType: line(100), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), hash: bytes32 }))
      .max(50),
    replaces: bytes32.refine((h) => h !== ZERO_BYTES32, "omit replaces instead of using zero").optional(),
  })
  .superRefine((doc, ctx) => {
    const d = doc.currency.decimals;
    const amount = (value: string, path: (string | number)[]) => {
      if (!isCanonicalAmount(value, d)) {
        ctx.addIssue({ code: "custom", path, message: `must have exactly ${d} fraction digits` });
      }
    };
    doc.lineItems.forEach((item, i) => {
      if (!isCanonicalQuantity(item.quantity)) {
        ctx.addIssue({ code: "custom", path: ["lineItems", i, "quantity"], message: "must be a positive canonical quantity" });
      }
      amount(item.unitPrice, ["lineItems", i, "unitPrice"]);
      amount(item.amount, ["lineItems", i, "amount"]);
    });
    doc.taxes.forEach((t, i) => amount(t.amount, ["taxes", i, "amount"]));
    doc.discounts.forEach((t, i) => amount(t.amount, ["discounts", i, "amount"]));
    amount(doc.subtotal, ["subtotal"]);
    amount(doc.total, ["total"]);
  });

/** A canonical invoice document (`symbolon.invoice.v1`): the full content a Seal commits to via `documentHash` */
export type InvoiceDocument = z.infer<typeof invoiceDocumentSchema>;

function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({ code: "schema", path: i.path.map(String).join("."), message: i.message }));
}

/** Strictly validates a canonical document. Anything non-canonical is rejected, never repaired. */
export function parseDocument(input: unknown): InvoiceDocument {
  const result = invoiceDocumentSchema.safeParse(input);
  if (!result.success) throw new SealError("invalid invoice document", toIssues(result.error));
  return result.data;
}

/** The exact bytes a document hash commits to */
export function canonicalDocument(doc: InvoiceDocument): string {
  return canonicalJson(parseDocument(doc));
}

/** `documentHash`: keccak256 of the canonical JSON's UTF-8 bytes */
export function documentHash(doc: InvoiceDocument): Hex {
  return keccak256(stringToBytes(canonicalDocument(doc)));
}

/** keccak256 of an attachment's bytes, as recorded in `attachments[].hash` */
export function attachmentHash(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

export function invoiceNumberHash(invoiceNumber: string): Hex {
  return keccak256(stringToBytes(invoiceNumber));
}

/** The PO reference both sides use: the business app opens POs with it, vendors cite it on invoices */
export function poRef(poNumber: string | undefined): Hex {
  return poNumber === undefined ? ZERO_BYTES32 : keccak256(stringToBytes(poNumber));
}

/** The payer's Vault address left-padded when they're on Symbolon, otherwise keccak256 of their lowercase email */
export function payerRef(payer: { vault?: string | undefined; email?: string | undefined }): Hex {
  if (payer.vault !== undefined) return pad(payer.vault as Hex, { size: 32 });
  if (payer.email !== undefined) return keccak256(stringToBytes(payer.email.toLowerCase()));
  throw new SealError("payer needs a vault address or an email");
}

/**
 * Every arithmetic and consistency problem in a (structurally valid) document. Empty means the numbers reconcile to
 * the last unit; nothing is rounded away except the documented half-up rounding of each line's quantity × price.
 */
export function checkDocument(doc: InvoiceDocument): Issue[] {
  const issues: Issue[] = [];
  const d = doc.currency.decimals;
  const raw = (v: string) => parseAmount(v, d);

  let subtotal = 0n;
  doc.lineItems.forEach((item, i) => {
    const expected = lineAmount(item.quantity, raw(item.unitPrice));
    if (raw(item.amount) !== expected) {
      issues.push({
        code: "line_amount",
        path: `lineItems.${i}.amount`,
        message: `${item.quantity} × ${item.unitPrice} is ${formatAmount(expected, d)}, not ${item.amount}`,
      });
    }
    subtotal += raw(item.amount);
  });
  if (raw(doc.subtotal) !== subtotal) {
    issues.push({ code: "subtotal", path: "subtotal", message: `line items sum to ${formatAmount(subtotal, d)}, not ${doc.subtotal}` });
  }

  let taxes = 0n;
  doc.taxes.forEach((t, i) => {
    if (t.rateBps !== undefined) {
      const expected = divRoundHalfUp(raw(doc.subtotal) * BigInt(t.rateBps), BPS_DENOMINATOR);
      if (raw(t.amount) !== expected) {
        issues.push({ code: "tax_rate", path: `taxes.${i}.amount`, message: `${t.rateBps} bps of the subtotal is ${formatAmount(expected, d)}, not ${t.amount}` });
      }
    }
    taxes += raw(t.amount);
  });
  const discounts = doc.discounts.reduce((sum, t) => sum + raw(t.amount), 0n);

  const total = raw(doc.subtotal) + taxes - discounts;
  if (total < 0n || raw(doc.total) !== total) {
    issues.push({ code: "total", path: "total", message: `subtotal + taxes − discounts is ${total < 0n ? `-${formatAmount(-total, d)}` : formatAmount(total, d)}, not ${doc.total}` });
  }
  if (raw(doc.total) === 0n) issues.push({ code: "total_zero", path: "total", message: "an invoice must be for more than zero" });

  if (doc.dueDate < doc.issuedAt) issues.push({ code: "due_before_issue", path: "dueDate", message: "due date is before the issue date" });

  doc.earlyPay.forEach((tier, i) => {
    const path = `earlyPay.${i}`;
    if (tier.discountBps === 0 || tier.discountBps > MAX_DISCOUNT_BPS) {
      issues.push({ code: "early_pay", path, message: `discount must be 1..${MAX_DISCOUNT_BPS} bps` });
    }
    if (tier.payBy < doc.issuedAt || tier.payBy > doc.dueDate) {
      issues.push({ code: "early_pay", path, message: "pay-by date must fall between the issue and due dates" });
    }
    const prev = doc.earlyPay[i - 1];
    if (prev && (tier.payBy <= prev.payBy || tier.discountBps >= prev.discountBps)) {
      issues.push({ code: "early_pay", path, message: "tiers must run later in time with smaller discounts" });
    }
  });

  return issues;
}

/**
 * The struct the Seal signs, derived entirely from the document so nothing is entered twice. Throws on any
 * structural or arithmetic issue: an invoice that doesn't reconcile is never produced for signing.
 */
export function toInvoice(input: InvoiceDocument): Invoice {
  const doc = parseDocument(input);
  const issues = checkDocument(doc);
  if (issues.length > 0) throw new SealError("invoice document doesn't reconcile", issues);
  return deriveInvoice(doc);
}

/**
 * The struct a structurally valid document commits to, without the arithmetic checks. Verification uses it so a
 * signed-but-inconsistent document can still be matched to its signature and shown with its issues.
 */
export function deriveInvoice(input: InvoiceDocument): Invoice {
  const doc = parseDocument(input);
  return {
    seal: doc.seal as Address,
    token: doc.currency.token as Address,
    amount: parseAmount(doc.total, doc.currency.decimals),
    issuedAt: BigInt(doc.issuedAt),
    dueDate: BigInt(doc.dueDate),
    payoutAddress: doc.payout.address as Address,
    payoutDomain: doc.payout.domain,
    payerRef: payerRef(doc.payer),
    invoiceNumberHash: invoiceNumberHash(doc.invoiceNumber),
    poRef: poRef(doc.poNumber),
    documentHash: documentHash(doc),
    replaces: (doc.replaces ?? ZERO_BYTES32) as Hex,
    earlyPay: doc.earlyPay.map((t) => ({ payBy: BigInt(t.payBy), discountBps: t.discountBps })),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Composer helpers: for turning what a person typed into a canonical document. Verification never calls these.
// ---------------------------------------------------------------------------------------------------------------------

const ADDRESS_KEYS = new Set(["seal", "token", "vault", "address"]);
const BYTES32_KEYS = new Set(["hash", "replaces"]);
const AMOUNT_KEYS = new Set(["unitPrice", "amount", "subtotal", "total"]);
const ARRAY_KEYS = ["taxes", "discounts", "earlyPay", "attachments"] as const;

function normalizeValue(key: string, value: unknown, decimals: number | undefined): unknown {
  if (typeof value === "string") {
    const s = value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
    if (s === "") return undefined;
    if (ADDRESS_KEYS.has(key) || BYTES32_KEYS.has(key) || key === "email") return s.toLowerCase();
    if (key === "quantity") return formatQuantity(parseQuantity(s));
    if (AMOUNT_KEYS.has(key) && decimals !== undefined) return formatAmount(parseAmount(s, decimals), decimals);
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeValue("", v, decimals));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const n = normalizeValue(k, v, decimals);
      if (n !== undefined) out[k] = n;
    }
    return out;
  }
  return value;
}

/**
 * Normalises composer input (NFC, trimmed, `\r\n` → `\n`, lowercase addresses/hashes/emails, amounts padded to the
 * token's decimals, blank optional fields dropped, missing lists empty) and then validates strictly. Amounts with
 * more precision than the token still throw: normalising never rounds.
 */
export function normalizeDocument(input: unknown): InvoiceDocument {
  if (typeof input !== "object" || input === null) throw new SealError("document must be an object");
  const currency = (input as { currency?: { decimals?: unknown } }).currency;
  const decimals = typeof currency?.decimals === "number" ? currency.decimals : undefined;
  const out = normalizeValue("", input, decimals) as Record<string, unknown>;
  for (const key of ARRAY_KEYS) out[key] ??= [];
  return parseDocument(out);
}

/** What the vendor's composer holds before totals are worked out */
export type DocumentDraft = Omit<InvoiceDocument, "lineItems" | "taxes" | "subtotal" | "total"> & {
  lineItems: { description: string; quantity: string; unitPrice: string }[];
  taxes: { label: string; rateBps?: number; amount?: string }[];
};

/**
 * Works out line amounts, rate-based tax amounts, the subtotal and the total from quantities, unit prices, flat
 * tax/discount amounts and rates, then normalises and validates the result. For the vendor's composer only.
 */
export function completeTotals(draft: DocumentDraft): InvoiceDocument {
  const d = draft.currency.decimals;
  const lineItems = draft.lineItems.map((item) => ({
    ...item,
    amount: formatAmount(lineAmount(item.quantity.trim(), parseAmount(item.unitPrice.trim(), d)), d),
  }));
  const subtotal = lineItems.reduce((sum, item) => sum + parseAmount(item.amount, d), 0n);
  const taxes = draft.taxes.map((t) => {
    if (t.rateBps !== undefined) {
      return { ...t, amount: formatAmount(divRoundHalfUp(subtotal * BigInt(t.rateBps), BPS_DENOMINATOR), d) };
    }
    if (t.amount === undefined) throw new SealError(`tax "${t.label}" needs a rate or an amount`);
    return { ...t, amount: t.amount };
  });
  const total =
    subtotal +
    taxes.reduce((sum, t) => sum + parseAmount(t.amount.trim(), d), 0n) -
    draft.discounts.reduce((sum, t) => sum + parseAmount(t.amount.trim(), d), 0n);
  if (total < 0n) throw new SealError("discounts exceed the subtotal plus taxes");
  return normalizeDocument({ ...draft, lineItems, taxes, subtotal: formatAmount(subtotal, d), total: formatAmount(total, d) });
}
