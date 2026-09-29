import { keccak256, pad, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";

import {
  canonicalDocument,
  checkDocument,
  completeTotals,
  documentHash,
  normalizeDocument,
  parseDocument,
  payerRef,
  poRef,
  SealError,
  toInvoice,
  ZERO_BYTES32,
  type InvoiceDocument,
} from "../src/index.js";
import { DAY, mutate, NOW, sampleDocument } from "./fixtures.js";

function schemaError(doc: unknown): SealError {
  try {
    parseDocument(doc);
  } catch (error) {
    if (error instanceof SealError) return error;
  }
  throw new Error("expected the document to be rejected");
}

describe("document validation", () => {
  it("accepts the composed sample", () => {
    const doc = sampleDocument();
    expect(doc.subtotal).toBe("3605.000000");
    expect(doc.taxes[0]?.amount).toBe("721.000000");
    expect(doc.total).toBe("4326.000000");
    expect(checkDocument(doc)).toEqual([]);
  });

  it.each<[string, (d: Record<string, any>) => void]>([
    ["unknown top-level key", (d) => (d.extra = "x")],
    ["unknown nested key", (d) => (d.vendor.phone = "123")],
    ["null optional", (d) => (d.poNumber = null)],
    ["wrong schema", (d) => (d.schema = "symbolon.invoice.v2")],
    ["uppercase address", (d) => (d.seal = d.seal.toUpperCase().replace("0X", "0x"))],
    ["checksummed payout", (d) => (d.payout.address = "0x530dF8c969Be62acbDc58aa33bC40027b66007d0")],
    ["uppercase email", (d) => (d.payer.email = "AP@acme.example")],
    ["decomposed (non-NFC) text", (d) => (d.vendor.name = "Estúdio")],
    ["bidi override", (d) => (d.lineItems[0].description = "Fee ‮evil")],
    ["zero-width direction mark", (d) => (d.vendor.name = "Ana‏")],
    ["control character", (d) => (d.invoiceNumber = "INV\u00070142")],
    ["newline in a single-line field", (d) => (d.invoiceNumber = "INV\n0142")],
    ["untrimmed text", (d) => (d.invoiceNumber = " INV-0142")],
    ["empty text", (d) => (d.invoiceNumber = "")],
    ["amount missing decimals", (d) => (d.total = "4326")],
    ["amount with extra precision", (d) => (d.total = "4326.0000000")],
    ["non-canonical quantity", (d) => (d.lineItems[1].quantity = "4.50")],
    ["zero quantity", (d) => (d.lineItems[1].quantity = "0")],
    ["float timestamp", (d) => (d.issuedAt = NOW + 0.5)],
    ["string timestamp", (d) => (d.issuedAt = String(NOW))],
    ["explicit zero replaces", (d) => (d.replaces = ZERO_BYTES32)],
    ["payer without vault or email", (d) => delete d.payer.email],
    ["no line items", (d) => (d.lineItems = [])],
    ["missing list", (d) => delete d.attachments],
  ])("rejects %s", (_name, change) => {
    const error = schemaError(mutate(sampleDocument(), change));
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues.every((i) => i.code === "schema")).toBe(true);
  });

  it("accepts multi-line text where the field allows it", () => {
    const doc = mutate(sampleDocument(), (d) => (d.notes = "Line one\nLine two"));
    expect(() => parseDocument(doc)).not.toThrow();
  });
});

describe("reconciliation", () => {
  const codes = (doc: InvoiceDocument) => checkDocument(doc).map((i) => i.code);

  it("flags a line amount that isn't quantity × price", () => {
    expect(codes(mutate(sampleDocument(), (d) => (d.lineItems[1].amount = "404.000000")))).toContain("line_amount");
  });

  it("flags a subtotal, tax or total that doesn't add up, to the last unit", () => {
    expect(codes(mutate(sampleDocument(), (d) => (d.subtotal = "3605.000001")))).toContain("subtotal");
    expect(codes(mutate(sampleDocument(), (d) => (d.taxes[0].amount = "720.999999")))).toContain("tax_rate");
    expect(codes(mutate(sampleDocument(), (d) => (d.total = "4325.999999")))).toContain("total");
  });

  it("flags discounts beyond the total and zero totals", () => {
    const doc = mutate(sampleDocument(), (d) => (d.discounts = [{ label: "Everything", amount: "5000.000000" }]));
    expect(codes(doc)).toContain("total");
  });

  it("flags bad dates and Early Pay curves", () => {
    expect(codes(mutate(sampleDocument(), (d) => (d.dueDate = NOW - 1)))).toContain("due_before_issue");
    expect(codes(mutate(sampleDocument(), (d) => (d.earlyPay[0].discountBps = 5001)))).toContain("early_pay");
    expect(codes(mutate(sampleDocument(), (d) => (d.earlyPay[0].discountBps = 0)))).toContain("early_pay");
    expect(codes(mutate(sampleDocument(), (d) => (d.earlyPay[1].payBy = NOW + 31 * DAY)))).toContain("early_pay");
    expect(codes(mutate(sampleDocument(), (d) => (d.earlyPay[1].payBy = NOW + 2 * DAY)))).toContain("early_pay");
    expect(codes(mutate(sampleDocument(), (d) => (d.earlyPay[1].discountBps = 200)))).toContain("early_pay");
  });

  it("never produces an invoice from a document that doesn't reconcile", () => {
    expect(() => toInvoice(mutate(sampleDocument(), (d) => (d.total = "4325.999999")))).toThrow(SealError);
  });
});

describe("hashing", () => {
  it("is independent of key order", () => {
    const doc = sampleDocument();
    const reversed = Object.fromEntries(Object.entries(doc).reverse()) as InvoiceDocument;
    expect(documentHash(reversed)).toBe(documentHash(doc));
  });

  it("changes when any single field changes", () => {
    const base = documentHash(sampleDocument());
    const changes: ((d: Record<string, any>) => void)[] = [
      (d) => (d.vendor.name = "Studio Ann"),
      (d) => (d.payer.email = "ap2@acme.example"),
      (d) => (d.invoiceNumber = "INV-0143"),
      (d) => (d.lineItems[0].description = "Brand identity."),
      (d) => (d.payout.address = `0x${"1".repeat(40)}`),
      (d) => (d.payout.domain = 6),
      (d) => (d.earlyPay[0].payBy += 1),
      (d) => (d.currency.symbol = "EURC"),
      (d) => (d.notes = "x"),
    ];
    const hashes = changes.map((change) => documentHash(mutate(sampleDocument(), change)));
    for (const h of hashes) expect(h).not.toBe(base);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("hashes the UTF-8 bytes of the canonical JSON", () => {
    const doc = sampleDocument();
    expect(documentHash(doc)).toBe(keccak256(stringToBytes(canonicalDocument(doc))));
    expect(canonicalDocument(doc)).not.toMatch(/\s"|":\s/);
  });
});

describe("deriving the signed invoice", () => {
  it("takes every field from the document", () => {
    const doc = sampleDocument();
    const invoice = toInvoice(doc);
    expect(invoice.amount).toBe(4_326_000_000n);
    expect(invoice.invoiceNumberHash).toBe(keccak256(stringToBytes("INV-0142")));
    expect(invoice.payerRef).toBe(keccak256(stringToBytes("ap@acme.example")));
    expect(invoice.poRef).toBe(ZERO_BYTES32);
    expect(invoice.replaces).toBe(ZERO_BYTES32);
    expect(invoice.documentHash).toBe(documentHash(doc));
    expect(invoice.earlyPay).toEqual([
      { payBy: BigInt(NOW + 3 * DAY), discountBps: 150 },
      { payBy: BigInt(NOW + 15 * DAY), discountBps: 75 },
    ]);
  });

  it("prefers the payer's vault over their email, and hashes PO numbers exactly", () => {
    const vault = `0x${"ab".repeat(20)}` as const;
    expect(payerRef({ vault, email: "a@b.example" })).toBe(pad(vault, { size: 32 }));
    expect(payerRef({ email: "AP@Acme.example" })).toBe(keccak256(stringToBytes("ap@acme.example")));
    expect(poRef("PO-2231")).toBe(keccak256(stringToBytes("PO-2231")));
    expect(poRef("PO-2231")).not.toBe(poRef("po-2231"));
    expect(() => payerRef({})).toThrow(SealError);
  });
});

describe("composer helpers", () => {
  it("normalises what a person typed without rounding", () => {
    const messy = mutate(sampleDocument(), (d) => {
      d.vendor.name = "  Estúdio Ana ";
      d.vendor.email = "Billing@Ana.Example";
      d.seal = d.seal.toUpperCase().replace("0X", "0x");
      d.total = "4326";
      d.lineItems[1].quantity = "4.50";
      d.notes = "a\r\nb";
      d.terms = "   ";
      delete d.attachments;
    });
    const doc = normalizeDocument(messy);
    expect(doc.vendor.name).toBe("Estúdio Ana");
    expect(doc.vendor.email).toBe("billing@ana.example");
    expect(doc.total).toBe("4326.000000");
    expect(doc.lineItems[1]?.quantity).toBe("4.5");
    expect(doc.notes).toBe("a\nb");
    expect(doc.terms).toBeUndefined();
    expect(doc.attachments).toEqual([]);
    expect(() => normalizeDocument(mutate(sampleDocument(), (d) => (d.total = "4326.0000001")))).toThrow(SealError);
  });

  it("works out totals from quantities, prices, rates and flat amounts", () => {
    const doc = completeTotals({
      ...sampleDocument(),
      lineItems: [{ description: "Hours", quantity: "7.5", unitPrice: "85.333333" }],
      taxes: [{ label: "Levy", amount: "10" }],
      discounts: [{ label: "Promo", amount: "0.999998" }],
    });
    expect(doc.lineItems[0]?.amount).toBe("639.999998");
    expect(doc.total).toBe("649.000000");
    expect(checkDocument(doc)).toEqual([]);
  });
});
