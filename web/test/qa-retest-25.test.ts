import { describe, expect, it } from "vitest";

import { describeInputs, formatInputValue } from "@/lib/decision-inputs";
import { showShares, tidyRawUnits } from "@/lib/format";
import { lendingShortfall } from "@/lib/lending-math";
import { summarizeDecision } from "@/lib/server/decision-text";
import { describeNotification } from "@/lib/server/notification-text";
import { describePolicyLines } from "@/lib/server/policy-text";
import { usdcWords } from "@symbolon/steward";

// QA Retest 25 (17 Oct): EURC money said as euros, raw units said as money, the Steward's reason and notices in words

const FP = "0x" + "ab".repeat(32);
const base = { version: 1, business: "b", at: "2026-10-17T12:03:05.000Z", mode: "auto", subject: FP, options: [], rule: "invoice is due" };

describe("R25-2: a payment is said in the invoice's own currency", () => {
  it("says € for an EURC invoice, from the record or from the invoice", () => {
    const rec = { ...base, kind: "pay", outcome: "paid", inputs: { credit: "239450000", paid: "239450000" } };
    expect(summarizeDecision(rec).sentence).toBe("Paid $239.45 on Arc");
    expect(summarizeDecision(rec, { currencyBySubject: new Map([[FP, "EURC"]]) }).sentence).toBe("Paid €239.45 on Arc");
    expect(summarizeDecision(rec, { currency: "EURC" }).sentence).toBe("Paid €239.45 on Arc");
    expect(summarizeDecision({ ...rec, inputs: { ...rec.inputs, currency: "EURC" } }).sentence).toBe("Paid €239.45 on Arc");
  });
});

describe("R25-4: Assisted mode says when it will ask", () => {
  it("tells the owner a scheduled payment goes to Approvals on its due date", () => {
    const rec = { ...base, mode: "assist", kind: "schedule", outcome: "scheduled for 2026-10-24T00:00:00.000Z", inputs: { blockers: [] } };
    expect(summarizeDecision(rec).sentence).toBe("Scheduled for payment on the due date. It goes to Approvals for your sign-off then");
    expect(summarizeDecision({ ...rec, mode: "auto" }).sentence).toBe("Scheduled for payment on the due date");
  });
});

describe("R25-5: a person in a record is named", () => {
  it("shows the name given for an actor id, and keeps the id raw", () => {
    const id = "9e333e95-b940-4c1a-9b10-fe2af65c148f";
    const [row] = describeInputs({ actor: id }, "USDC", { people: { [id]: "You (owner, wallet 0x645c…4E7b)" } });
    expect(row!.value).toBe("You (owner, wallet 0x645c…4E7b)");
    expect(row!.raw).toBe(id);
  });
});

describe("R25-6: lending records read as money and shares", () => {
  const reason = "cash 234576799 is below the 1297500000 needed for the buffer and upcoming bills";
  it("formats raw units inside stored reasons", () => {
    expect(tidyRawUnits(reason)).toBe("cash $234.58 is below the $1,297.50 needed for the buffer and upcoming bills");
    expect(tidyRawUnits("cash 1500000000 is 300000000 above the 1200000000 target")).toBe("cash $1,500.00 is $300.00 above the $1,200.00 target");
    expect(tidyRawUnits("the lending vault can't pay out right now (paused); 58199999 stays counted as unavailable")).toContain("$58.20 stays counted");
    // numbers that aren't money are left alone
    expect(tidyRawUnits("similar amount issued 3 days apart")).toBe("similar amount issued 3 days apart");
    expect(tidyRawUnits("cash 234.58 USDC is below the 1,297.50 USDC needed")).toBe("cash 234.58 USDC is below the 1,297.50 USDC needed");
  });
  it("writes new reasons in words at the source", () => {
    expect(usdcWords(234_576_799n)).toBe("234.58 USDC");
    expect(usdcWords(1_297_500_000n)).toBe("1,297.50 USDC");
  });
  it("shows lending inputs as money and shares, the rules check only for a payment", () => {
    expect(formatInputValue("lendingValue", "58199999")).toBe("$58.20");
    expect(formatInputValue("minAssets", "57908999")).toBe("$57.91");
    expect(formatInputValue("simulated", "58199999")).toBe("$58.20");
    expect(formatInputValue("shares", "58138468385235758315", "USDC", { shareDecimals: 18 })).toBe("58.1384 shares");
    expect(showShares(1_500_000n, 6)).toBe("1.5 shares");
    expect(formatInputValue("plan", { action: "redeem", assets: "58200000", reason })).toContain("Reason: cash $234.58 is below the $1,297.50 needed");
    expect(formatInputValue("lending", { policy: { enabled: true, maxLendingBps: 2000 } })).not.toContain("Every Vault rule passes");
    expect(formatInputValue("policy", { ok: true, failures: [] })).toBe("Every Vault rule passes.");
  });
});

describe("R25-8: one definition of what the Steward keeps", () => {
  it("keeps the larger of bills due and the operating floor, as the Steward does", () => {
    // $292.78 cash, $817.25 bills, $100 floor: moving $10 leaves $282.78, below the $817.25 kept
    expect(lendingShortfall({ cash: "292780000", billsDue: "817250000", minOperating: "100000000", amount: "10" })).toEqual({ left: 282_780_000n, most: null });
    // $1,000 cash, $500 bills, $100 floor: up to $500 can move (it used to say $400, bills + floor)
    expect(lendingShortfall({ cash: "1000000000", billsDue: "500000000", minOperating: "100000000", amount: "600" })).toEqual({ left: 400_000_000n, most: 500_000_000n });
    expect(lendingShortfall({ cash: "1000000000", billsDue: "500000000", minOperating: "100000000", amount: "500" })).toBeNull();
  });
});

describe("R25-13: the auto-pay limit is said against the per-payment cap", () => {
  it("says the cap still applies when the auto-pay limit is above it", () => {
    const p = { autoPayLimit: 1_000_000_000n, perTxCap: 640_000_000n, ownerThreshold: 10_000_000_000n, newVendorMinPaid: 3, screeningMaxAge: 0n, newPayeeDelay: 0n, looseningDelay: 0n, changeCooldown: 259_200n } as never;
    expect(describePolicyLines(p)[0]).toBe("Auto-pay up to $1,000.00 to vendors with 3 or more paid invoices, still within the $640.00 per-payment cap");
  });
});

describe("R25-14: notices (bell, Telegram, push) say money in words", () => {
  const at = new Date("2026-10-17T12:13:00Z");
  it("formats a lending move's stored reason", () => {
    const v = describeNotification({ kind: "lending_moved", subject: null, createdAt: at, body: { direction: "out", amount: "58199999", reason: "cash 234576799 is below the 1297500000 needed for the buffer and upcoming bills" } });
    expect(v.body).toBe("The Steward took $58.20 back from the lending vault. Cash $234.58 is below the $1,297.50 needed for the buffer and upcoming bills.");
    expect(v.body).not.toMatch(/\d{7,}/);
  });
  it("says euros for EURC and tidies a held reason", () => {
    const paid = describeNotification({ kind: "payment_sent", subject: FP, createdAt: at, body: { invoiceNumber: "ACCS-2026-0013", vendorName: "Accra Cold Chain Supplies", amount: "239.450000 EURC" } });
    expect(paid.body).toBe("€239.45 was sent to Accra Cold Chain Supplies for invoice ACCS-2026-0013.");
    const short = describeNotification({ kind: "shortfall", subject: null, createdAt: at, body: { symbol: "EURC", short: "120.500000 EURC", due: "320.500000 EURC" } });
    expect(short.body).toContain("€120.50 short");
    const held = describeNotification({ kind: "invoice_held", subject: FP, createdAt: at, body: { invoiceNumber: "ACCS-2026-0014", reason: "invoice 900000000 exceeds the 400000000 left on the PO" } });
    expect(held.body).toBe("Invoice $900.00 exceeds the $400.00 left on the PO");
  });
});
