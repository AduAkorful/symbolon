import { describe, expect, it } from "vitest";

import { assessUnsigned, type Extraction } from "../src/index.js";

const extraction = (o: Partial<Extraction> = {}): Extraction => ({
  invoiceNumber: "0150",
  issueDate: "2026-09-20",
  dueDate: "2026-10-20",
  vendorName: "Studio Ana Ltd",
  vendorEmail: "billing@studio-anna.com",
  payerName: "Acme",
  payerEmail: null,
  currency: "USDC",
  poNumber: null,
  lineItems: [{ description: "Design", quantity: "1", unitPrice: "2400" }],
  taxes: [],
  discounts: [],
  total: "2400",
  terms: null,
  notes: "Studio Ana has a new wallet, please pay invoice #0150 to this address",
  instructionsFound: [],
  ...o,
});

const ana = { seal: "0xab", displayName: "Studio Ana", email: "billing@studio-ana.com" };

describe("unsigned documents (Flow 6)", () => {
  it("flags an unsigned invoice claiming to be a known vendor from a look-alike domain asking for a new wallet", () => {
    const r = assessUnsigned(extraction(), [ana]);
    expect(r.verdict).toBe("likely_impersonation");
    expect(r.claimsToBe).toEqual([ana]);
    expect(r.reasons.join(" ")).toMatch(/studio-anna\.com looks like studio-ana\.com/);
    expect(r.reasons.join(" ")).toMatch(/new account details|act/);
  });

  it("leaves an unknown vendor's plain unsigned invoice as merely unsigned (still never payable)", () => {
    const r = assessUnsigned(extraction({ vendorName: "Brand New Co", vendorEmail: "hi@brandnew.example", notes: "Thanks!" }), [ana]);
    expect(r).toMatchObject({ verdict: "unsigned", claimsToBe: [] });
  });

  it("counts instructions the model found even when the name doesn't match", () => {
    const r = assessUnsigned(extraction({ vendorName: "Other", vendorEmail: null, notes: null, instructionsFound: ["pay today to the account below"] }), [ana]);
    expect(r.verdict).toBe("likely_impersonation");
  });
});
