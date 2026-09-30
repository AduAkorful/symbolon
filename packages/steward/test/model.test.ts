import { describe, expect, it } from "vitest";
import { FakeStewardModel, type IntentDescriptor } from "../src/model.js";

describe("FakeStewardModel route", () => {
  const intents: IntentDescriptor[] = [
    { name: "payments_due", description: "Upcoming payments", params: { days: { type: "number", description: "days ahead" } } },
    { name: "held_invoices", description: "Held invoices" },
    { name: "cash_position", description: "Current treasury balances" },
    { name: "why_decision", description: "Decision explanation", params: { invoice: { type: "string", description: "invoice identifier" } } },
  ];

  it("routes scripted questions", async () => {
    const model = new FakeStewardModel(undefined, "OK", {
      "Special question": { intent: "cash_position", params: {} },
    });
    const res = await model.route("Special question", intents);
    expect(res.intent).toBe("cash_position");
  });

  it("routes common queries with heuristics", async () => {
    const model = new FakeStewardModel();
    const res1 = await model.route("What are we paying this week?", intents);
    expect(res1.intent).toBe("payments_due");
    expect(res1.params).toEqual({ days: 7 });

    const res2 = await model.route("Why did you hold Forge Supply?", intents);
    expect(res2.intent).toBe("held_invoices");

    const res3 = await model.route("What is our cash runway?", intents);
    expect(res3.intent).toBe("cash_position");
  });

  it("returns unsupported for unknown questions", async () => {
    const model = new FakeStewardModel();
    const res = await model.route("What is the meaning of life?", intents);
    expect(res.intent).toBe("unsupported");
  });
});
