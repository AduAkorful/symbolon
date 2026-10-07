import { describe, expect, it } from "vitest";
import { AnthropicStewardModel, type IntentDescriptor } from "../src/model.js";
import { FakeStewardModel } from "../src/testing.js";

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
    if (!("params" in res1)) throw new Error("Expected a supported route");
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

describe("AnthropicStewardModel route (stubbed client)", () => {
  const intents: IntentDescriptor[] = [
    { name: "payments_due", description: "Upcoming payments", params: { days: { type: "number", description: "days ahead" } } },
    { name: "held_invoices", description: "Held invoices" },
  ];

  it("asks for the flat, closed route schema built from the registry and maps the answer", async () => {
    let seen: any;
    const client = {
      messages: {
        parse: async (args: unknown) => {
          seen = args;
          return { stop_reason: "end_turn", parsed_output: { intent: "payments_due", params: { days: 14 }, reason: null } };
        },
      },
    };
    const model = new AnthropicStewardModel(client as never);
    const res = await model.route("What is due in two weeks?", intents);
    expect(res).toEqual({ intent: "payments_due", params: { days: 14 } });
    const schema = JSON.stringify(seen.output_config.format.schema);
    expect(schema).not.toContain("propertyNames");
    expect(seen.output_config.format.schema.properties.params.additionalProperties).toBe(false);
    // the SDK's helper moves the enum into the description; our own zod parse still enforces it
    expect(seen.output_config.format.schema.properties.intent.description).toContain("held_invoices");
    expect(Object.keys(seen.output_config.format.schema.properties).sort()).toEqual(["intent", "params", "reason"]);
  });

  it("returns unsupported on a refusal or no output", async () => {
    const refusing = { messages: { parse: async () => ({ stop_reason: "refusal", parsed_output: null }) } };
    expect((await new AnthropicStewardModel(refusing as never).route("x", intents)).intent).toBe("unsupported");
    const empty = { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: null }) } };
    expect((await new AnthropicStewardModel(empty as never).route("x", intents)).intent).toBe("unsupported");
  });
});

describe("route history (plan 05y B3, B8)", () => {
  const intents: IntentDescriptor[] = [
    { name: "payments_due", description: "Upcoming payments", params: { days: { type: "number", description: "days ahead" } } },
    { name: "held_invoices", description: "Held invoices" },
  ];
  const history = [{ question: "What are we paying this week?", intent: "payments_due", params: { days: 7 } }];

  it("the scripted model repeats the last intent for a follow-up", async () => {
    const res = await new FakeStewardModel().route("and next month?", intents, history);
    expect(res).toEqual({ intent: "payments_due", params: { days: 7 } });
    expect((await new FakeStewardModel().route("and next month?", intents)).intent).toBe("unsupported");
  });

  it("the Claude-backed model sends the same previous-turns block", async () => {
    let seen: any;
    const client = { messages: { parse: async (args: unknown) => ((seen = args), { stop_reason: "end_turn", parsed_output: { intent: "held_invoices", params: { days: null }, reason: null } }) } };
    await new AnthropicStewardModel(client as never).route("and held?", intents, history);
    expect(seen.system).toContain("<previous_turns>");
    expect(seen.system).toContain("What are we paying this week?");
    expect(seen.messages).toEqual([{ role: "user", content: "and held?" }]);
  });
});
