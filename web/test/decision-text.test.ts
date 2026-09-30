import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeDecision } from "@/lib/server/decision-text";

describe("summarizeDecision", () => {
  it("summarizes paid decision with formatted USDC amount", () => {
    const s = summarizeDecision({
      kind: "pay",
      outcome: "paid",
      inputs: { amount: "1500000000" }, // 1,500 USDC
      explanation: "Approved based on matching purchase order.",
    });
    expect(s.sentence).toBe("Paid $1,500.00 on Arc");
    expect(s.explanation).toBe("Approved based on matching purchase order.");
  });

  it("summarizes proposed payment in shadow/assist mode", () => {
    const s = summarizeDecision({
      kind: "pay",
      outcome: "proposed",
      inputs: { amount: "25000000" }, // 25 USDC
    });
    expect(s.sentence).toBe("Proposed paying $25.00");
  });

  it("summarizes schedule decisions", () => {
    const s = summarizeDecision({
      kind: "schedule",
      outcome: "scheduled",
      rule: "scheduled for release on due date",
    });
    expect(s.sentence).toBe("Scheduled for payment on due date");
  });

  it("summarizes hold decisions with rule", () => {
    const s = summarizeDecision({
      kind: "hold",
      outcome: "held",
      rule: "delivery confirmation required by payee terms; none on file",
    });
    expect(s.sentence).toBe("Held: delivery confirmation required by payee terms; none on file");
  });

  it("summarizes reject decisions with rule", () => {
    const s = summarizeDecision({
      kind: "reject",
      outcome: "rejected",
      rule: "only genuine, consistent invoices sealed for this ledger are payable",
    });
    expect(s.sentence).toBe("Rejected: only genuine, consistent invoices sealed for this ledger are payable");
  });

  it("summarizes refuse decisions with rule", () => {
    const s = summarizeDecision({
      kind: "refuse",
      outcome: "refused",
      rule: "simulation reverted: allowance exceeded",
    });
    expect(s.sentence).toBe("Refused by Vault: simulation reverted: allowance exceeded");
  });

  it("summarizes request_approval decisions", () => {
    const s = summarizeDecision({
      kind: "request_approval",
      outcome: "awaiting_approval",
      rule: "amount exceeds single transaction limit",
    });
    expect(s.sentence).toBe("Awaiting approval: amount exceeds single transaction limit");
  });

  it("summarizes steward_mode_changed decisions", () => {
    const s = summarizeDecision({
      kind: "steward_mode_changed",
      inputs: { from: "shadow", to: "assist" },
    });
    expect(s.sentence).toBe("Steward mode switched from shadow to assist");
  });

  it("summarizes steward_fees_funded decisions", () => {
    const s = summarizeDecision({
      kind: "steward_fees_funded",
      inputs: { amount: "2000000000000000000" },
    });
    expect(s.sentence).toBe("Steward wallet funded with network fees 2000000000000000000 units");
  });

  it("handles unknown decision kinds gracefully without throwing", () => {
    const s = summarizeDecision({
      kind: "custom_op",
      foo: "bar",
    });
    expect(s.sentence).toBe("Recorded: custom_op");
  });
});
