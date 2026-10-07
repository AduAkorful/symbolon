import { z } from "zod";

import type { IntentDescriptor, RouteResult } from "./model.js";

/**
 * The structured answer a model gives when routing an Ask question. Built from the intent registry, flat and closed:
 * every key is required and every parameter nullable, with no free-form map, because strict structured outputs
 * reject maps (plan 05x X8). Parameter values are still validated by each intent's own handler.
 */
export function routeSchemaFor(intents: IntentDescriptor[]) {
  const shape: Record<string, z.ZodType> = {};
  const kinds: Record<string, string> = {};
  for (const intent of intents) {
    for (const [name, p] of Object.entries(intent.params ?? {})) {
      const kind = p.type === "number" || p.type === "boolean" ? p.type : "string";
      if (kinds[name] !== undefined && kinds[name] !== kind) throw new Error(`intents give the parameter "${name}" two different types`);
      kinds[name] = kind;
      const base = kind === "number" ? z.number() : kind === "boolean" ? z.boolean() : z.string();
      shape[name] ??= base.nullable().describe(p.description);
    }
  }
  return z.object({
    intent: z.enum(["unsupported", ...intents.map((i) => i.name)]).describe("The matched intent, or 'unsupported' if none matches"),
    params: z.object(shape),
    reason: z.string().nullable().describe("Why the question is unsupported; null otherwise"),
  });
}

export type RouteAnswer = z.infer<ReturnType<typeof routeSchemaFor>>;

/** The model's answer as a RouteResult: null params dropped, params of other intents dropped, anything unrecognised is "unsupported" */
export function toRouteResult(parsed: RouteAnswer, intents: IntentDescriptor[]): RouteResult {
  const matched = intents.find((i) => i.name === parsed.intent);
  if (!matched || parsed.intent === "unsupported") {
    return parsed.reason ? { intent: "unsupported", reason: parsed.reason } : { intent: "unsupported" };
  }
  const declared = new Set(Object.keys(matched.params ?? {}));
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.params as Record<string, unknown>)) {
    if (v !== null && v !== undefined && declared.has(k)) params[k] = v;
  }
  return { intent: matched.name, params };
}
