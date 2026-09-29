import { describe, expect, it } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { checkDocument } from "@symbolon/seal";
import { buildDocument, type ComposeContext, type ComposerDraft } from "@/lib/server/compose";
import { AuthError } from "@/lib/server/errors";

const dep = getDeployment(arcTestnet.id);
const SEAL = "0x1111111111111111111111111111111111111111";
const VAULT = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-29T12:00:00Z");
const ISSUED = Math.floor(NOW.getTime() / 1000);

const ctx = (over: Partial<ComposeContext["seal"]> = {}): ComposeContext => ({
  now: NOW,
  chainId: arcTestnet.id,
  seal: { address: SEAL, displayName: "Studio Ana", legalName: null, website: null, payoutAddress: null, ...over },
  tokens: { USDC: dep.tokens.usdc, EURC: dep.tokens.eurc },
  decimals: 6,
  payoutDomain: dep.cctpDomain,
});

const draft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({
  client: { name: "Acme Operations", vault: VAULT },
  currency: "USDC",
  invoiceNumber: "0144",
  dueDays: 30,
  lines: [
    { description: "Brand refresh", quantity: "1", unitPrice: "1600" },
    { description: "Launch templates", quantity: "8", unitPrice: "100" },
  ],
  ...over,
});

const refused = (d: ComposerDraft, c = ctx()) => {
  try {
    buildDocument(d, c);
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    expect((e as AuthError).status).toBe(400);
    return (e as AuthError).message;
  }
  throw new Error("expected the draft to be refused");
};

describe("buildDocument: exact totals from what was typed", () => {
  it("works the lines, tax and total out in token precision and the result reconciles", () => {
    const d = buildDocument(draft({ taxPercent: "20" }), ctx());
    expect(d.lineItems.map((l) => l.amount)).toEqual(["1600.000000", "800.000000"]);
    expect(d.subtotal).toBe("2400.000000");
    expect(d.taxes).toEqual([{ label: "Tax", rateBps: 2000, amount: "480.000000" }]);
    expect(d.total).toBe("2880.000000");
    expect(checkDocument(d)).toEqual([]);
  });

  it("keeps fractional quantities and prices exact, rounding half up only where the seal package does", () => {
    const d = buildDocument(draft({ lines: [{ description: "Hours", quantity: "1.5", unitPrice: "10.25" }], taxPercent: "7.5" }), ctx());
    expect(d.lineItems[0]!.amount).toBe("15.375000");
    expect(d.taxes[0]!.rateBps).toBe(750);
    expect(checkDocument(d)).toEqual([]);
  });

  it("takes the seal, token, chain, payout and issue time from the server, not the draft", () => {
    const d = buildDocument(draft(), ctx());
    expect(d.seal).toBe(SEAL);
    expect(d.currency).toEqual({ chainId: arcTestnet.id, token: dep.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 });
    expect(d.issuedAt).toBe(ISSUED);
    expect(d.dueDate).toBe(ISSUED + 30 * 86_400);
    expect(d.payout).toEqual({ address: SEAL, domain: dep.cctpDomain });
    expect(d.attachments).toEqual([]);
    expect(d.vendor.name).toBe("Studio Ana");
    expect(d.payer.vault).toBe(VAULT);
  });

  it("uses EURC's registry address for EURC, and the vendor's payout address when set", () => {
    const payout = "0x3333333333333333333333333333333333333333";
    const d = buildDocument(draft({ currency: "EURC" }), ctx({ payoutAddress: payout }));
    expect(d.currency.token).toBe(dep.tokens.eurc.toLowerCase());
    expect(d.currency.symbol).toBe("EURC");
    expect(d.payout.address).toBe(payout);
  });

  it("lowercases an email and accepts an email alone", () => {
    const d = buildDocument(draft({ client: { name: "Halden Retail", email: " AP@Halden.Example " } }), ctx());
    expect(d.payer).toEqual({ name: "Halden Retail", email: "ap@halden.example" });
  });

  it("turns Early Pay tiers into signed pay-by dates and basis points", () => {
    const d = buildDocument(draft({ earlyPay: [{ percent: "1.5", days: 3 }, { percent: "0.75", days: 15 }] }), ctx());
    expect(d.earlyPay).toEqual([
      { payBy: ISSUED + 3 * 86_400, discountBps: 150 },
      { payBy: ISSUED + 15 * 86_400, discountBps: 75 },
    ]);
  });

  it("carries a PO number, terms and notes only when given", () => {
    const d = buildDocument(draft({ poNumber: "PO-0036", notes: "Thanks!\r\nAna", terms: "" }), ctx());
    expect(d.poNumber).toBe("PO-0036");
    expect(d.notes).toBe("Thanks!\nAna");
    expect("terms" in d).toBe(false);
  });
});

describe("buildDocument: what is refused, with a reason", () => {
  const line = (over: Record<string, string>) => [{ description: "Work", quantity: "1", unitPrice: "10", ...over }];
  it.each([
    ["no lines", { lines: [] }],
    ["lines that are not a list", { lines: "one" }],
    ["a blank description", { lines: line({ description: " " }) }],
    ["a zero quantity", { lines: line({ quantity: "0" }) }],
    ["a negative price", { lines: line({ unitPrice: "-5" }) }],
    ["exponent notation", { lines: line({ unitPrice: "1e3" }) }],
    ["more price decimals than the token", { lines: line({ unitPrice: "1.0000001" }) }],
    ["a zero total", { lines: line({ unitPrice: "0" }) }],
    ["a bad currency", { currency: "BTC" }],
    ["a due date of 0 days", { dueDays: 0 }],
    ["a due date past a year", { dueDays: 366 }],
    ["a due date that isn't a number", { dueDays: "soon" }],
    ["no way to reach the client", { client: { name: "Acme" } }],
    ["a bad Vault address", { client: { name: "Acme", vault: "0x12" } }],
    ["a client name that is too short", { client: { name: "A", vault: VAULT } }],
    ["a tax above 100%", { taxPercent: "100.01" }],
    ["a tax with too many decimals", { taxPercent: "7.555" }],
    ["a tax that isn't a number", { taxPercent: "lots" }],
    ["an Early Pay discount of 10%", { earlyPay: [{ percent: "10", days: 3 }] }],
    ["an Early Pay discount of 0%", { earlyPay: [{ percent: "0", days: 3 }] }],
    ["an Early Pay window not before the due date", { dueDays: 10, earlyPay: [{ percent: "1", days: 10 }] }],
    ["four Early Pay tiers", { earlyPay: [1, 2, 3, 4].map((n) => ({ percent: "1", days: n })) }],
    ["Early Pay tiers with a bigger discount later", { earlyPay: [{ percent: "1", days: 3 }, { percent: "2", days: 10 }] }],
    ["a control character in a description", { lines: line({ description: "bad\u0007text" }) }],
    ["a bidi override in a description", { lines: line({ description: "pay \u202Etxt" }) }],
    ["a control character in the invoice number", { invoiceNumber: "01\u0000" }],
  ] as [string, Partial<ComposerDraft>][])("refuses %s", (_name, over) => {
    expect(refused(draft(over)).length).toBeGreaterThan(5);
  });

  it("refuses more lines than the limit", () => {
    expect(refused(draft({ lines: Array.from({ length: 101 }, () => ({ description: "x", quantity: "1", unitPrice: "1" })) }))).toMatch(/up to 100 lines/);
  });
});
