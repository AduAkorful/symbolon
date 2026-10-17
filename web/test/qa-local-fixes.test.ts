import { describe, expect, it } from "vitest";
import { buildId } from "@/lib/build-id";
import { summarizeDecision, tidySignOff } from "@/lib/server/decision-text";
import { describePolicyRuleItems } from "@/lib/server/policy-text";
import { policyTemplate } from "@/lib/server/policy-text";

describe("BUILD-1: the footer's build id", () => {
  it("shortens a commit and ignores anything else", () => {
    expect(buildId({ VERCEL_GIT_COMMIT_SHA: "03cc28d9f0e1a2b3c4d5e6f708192a3b4c5d6e7f" })).toBe("03cc28d");
    expect(buildId({ NEXT_PUBLIC_BUILD_ID: "ABCDEF1234" })).toBe("abcdef1");
    expect(buildId({})).toBeNull();
    expect(buildId({ NEXT_PUBLIC_BUILD_ID: "not a sha" })).toBeNull();
  });
});

describe("STW-4: a scheduled record names the discount it considered", () => {
  const base = { kind: "schedule", inputs: { blockers: [] }, rule: "pay on the due date", outcome: "scheduled for 2026-10-27" };
  it("leads with a signed offer", () => {
    const s = summarizeDecision({ ...base, options: [{ kind: "offer", discountBps: 50, reasons: ["annualized 6% is below the minimum"] }] });
    expect(s.sentence).toBe("Considered the 0.5% offer, not taken: its return is below your minimum spread over the reserve yield. Scheduled for payment on the due date");
  });
  it("falls back to the invoice's own Early Pay tier", () => {
    const s = summarizeDecision({ ...base, options: [{ kind: "tier", discountBps: 150, reasons: ["would leave the forecast buffer short"] }] });
    expect(s.sentence).toBe("Considered the 1.5% Early Pay term in the invoice, not taken: paying early would take cash below your buffer. Scheduled for payment on the due date");
  });
});

describe("ACT-1: lending rows say which one moved money", () => {
  it("labels a Steward suggestion and an owner's prepared move", () => {
    expect(summarizeDecision({ kind: "sweep", inputs: { venue: "0x1" }, outcome: "proposed" }).sentence).toBe("The Steward suggested moving cash into the lending vault (a suggestion only; no money moved)");
    expect(summarizeDecision({ kind: "sweep", inputs: { venue: "0x1", actor: "u1" }, outcome: "depositing" }).sentence).toBe("Prepared the lending move");
  });
});

describe("UI-7: the policy page names the owner", () => {
  it("says who signs between the limits and above them", () => {
    const item = describePolicyRuleItems(policyTemplate("standard")).find((i) => i.id === "ownerThreshold");
    expect(item?.note).toBe("Between the auto-pay limit and this, a budget’s approver or the owner signs; above it, the owner signs");
  });
});

describe("UI-2: older records no longer say only an approver can sign", () => {
  it("rewords the stored explanation and sentence for display only", () => {
    const record = {
      kind: "hold",
      rule: "the payment requires an approver's sign-off",
      explanation: "No signed discount was listed to justify paying earlier, and the payment requires an approver’s sign-off.",
    };
    const s = summarizeDecision(record);
    expect(s.sentence).toBe("Held: the payment requires a sign-off from an approver or the owner");
    expect(s.explanation).toBe("No signed discount was listed to justify paying earlier, and the payment requires a sign-off from an approver or the owner.");
    // the record itself is untouched
    expect(record.rule).toBe("the payment requires an approver's sign-off");
  });
  it("keeps a sentence's capital", () => {
    expect(tidySignOff("An approver's sign-off is needed.")).toBe("A sign-off from an approver or the owner is needed.");
    expect(tidySignOff("needs the owner's sign-off")).toBe("needs the owner's sign-off");
  });
});
