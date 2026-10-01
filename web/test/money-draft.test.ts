import { describe, expect, it } from "vitest";
import { moneyDraft, moneyInput } from "@/lib/money-draft";
import { policyTemplate } from "@/lib/policy-template";

describe("exact policy, budget and payee form amounts", () => {
  it("preserves the last fractional unit and large integer amounts", () => {
    expect(moneyDraft("1.000001", 6)).toEqual({ raw: 1000001n });
    const raw = 9007199254740993123456n;
    expect(moneyDraft(moneyInput(raw, 6), 6)).toEqual({ raw });
  });
  it("roundtrips every template money field without multiplying the bridge fee", () => {
    for (const name of ["starter", "standard", "strict"] as const) {
      const policy = policyTemplate(name);
      for (const field of ["perTxCap", "autoPayLimit", "ownerThreshold", "maxBridgeFee"] as const) {
        expect(moneyDraft(moneyInput(policy[field], 6), 6)).toEqual({ raw: policy[field] });
      }
    }
  });
  it.each(["", "-1", "1.0000001", "NaN", "1e6"])("refuses invalid money %s", (value) => {
    expect(moneyDraft(value, 6)).toHaveProperty("error");
    expect(moneyDraft(value, 6)).not.toHaveProperty("raw");
  });
});
