import { describe, expect, it } from "vitest";

import { completeTotals, SealError, seriesDrafts, toInvoice, type DocumentDraft } from "../src/index.js";
import { NOW, sampleDocument } from "./fixtures.js";

const jan31 = Date.UTC(2027, 0, 31, 9) / 1000;

describe("recurring series", () => {
  /** The sample document as a composer draft: amounts dropped so completeTotals works them out again */
  const template = (): DocumentDraft => {
    const { lineItems, taxes, subtotal: _s, total: _t, ...rest } = sampleDocument();
    return {
      ...rest,
      lineItems: lineItems.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
      taxes: taxes.map(({ label, rateBps }) => (rateBps === undefined ? { label } : { label, rateBps })),
    };
  };

  it("follows calendar months, clamping to month ends (including a leap year)", () => {
    const drafts = seriesDrafts({ ...template(), issuedAt: jan31, dueDate: jan31 + 30 * 86_400, earlyPay: [] }, {
      start: jan31,
      periods: 14,
      every: "monthly",
      dueAfterDays: 30,
    });
    const days = drafts.map((d) => new Date(d.issuedAt * 1000).toISOString().slice(0, 10));
    expect(days.slice(0, 4)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(days[13]).toBe("2028-02-29");
    expect(drafts.map((d) => d.invoiceNumber).slice(0, 2)).toEqual(["INV-0142-01", "INV-0142-02"]);
    expect(drafts[0]!.dueDate - drafts[0]!.issuedAt).toBe(30 * 86_400);
  });

  it("shifts Early Pay tiers with each period and yields sealable documents", () => {
    const drafts = seriesDrafts(template(), { start: NOW, periods: 3, every: { days: 14 }, dueAfterDays: 30 });
    expect(drafts[2]!.earlyPay[0]!.payBy - drafts[2]!.issuedAt).toBe(template().earlyPay[0]!.payBy - template().issuedAt);
    for (const d of drafts) expect(() => toInvoice(completeTotals(d))).not.toThrow();
  });

  it("rejects silly schedules", () => {
    expect(() => seriesDrafts(template(), { start: NOW, periods: 0, every: "monthly", dueAfterDays: 30 })).toThrow(SealError);
    expect(() => seriesDrafts(template(), { start: NOW, periods: 61, every: "monthly", dueAfterDays: 30 })).toThrow(SealError);
    expect(() => seriesDrafts(template(), { start: NOW, periods: 2, every: { days: 0 }, dueAfterDays: 30 })).toThrow(SealError);
  });
});
