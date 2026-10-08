import { z } from "zod";

import type { IntentDescriptor, PlanResult, RouteResult } from "./model.js";

/**
 * The structured answer a model gives when routing an Ask question. Built from the intent registry, flat and closed:
 * every key is required and every parameter nullable, with no free-form map, because strict structured outputs
 * reject maps (plan 05x X8). Parameter values are still validated by each intent's own handler.
 */
function paramShape(intents: IntentDescriptor[]) {
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
  return shape;
}

export function routeSchemaFor(intents: IntentDescriptor[]) {
  const shape = paramShape(intents);
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

/** Most lookups one message may ask for: enough for a question across topics, few enough to stay quick and cheap */
export const MAX_READS = 3;

/**
 * What a model returns when it plans an Ask turn (plan 05ze): the lookups to run (none for a greeting), and a short question back
 * when a vendor or invoice is needed and not named. Flat and closed like the route schema.
 */
export function planSchemaFor(intents: IntentDescriptor[]) {
  const shape = paramShape(intents);
  return z.object({
    reads: z
      .array(z.object({ intent: z.enum(intents.map((i) => i.name) as [string, ...string[]]), params: z.object(shape) }))
      .describe(`The lookups needed to answer the latest message, at most ${MAX_READS}; empty when none is needed`),
    clarify: z.string().nullable().describe("One short question to ask when a vendor or invoice is needed and not named; otherwise null"),
  });
}

export type PlanAnswer = z.infer<ReturnType<typeof planSchemaFor>>;

/** The model's plan as a PlanResult: unknown intents and undeclared or null params dropped, repeats removed, capped */
export function toPlanResult(parsed: PlanAnswer, intents: IntentDescriptor[]): PlanResult {
  const reads: PlanResult["reads"] = [];
  const seen = new Set<string>();
  for (const r of parsed.reads) {
    const matched = intents.find((i) => i.name === r.intent);
    if (!matched) continue;
    const declared = new Set(Object.keys(matched.params ?? {}));
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
      if (v !== null && v !== undefined && declared.has(k)) params[k] = v;
    }
    const key = `${matched.name}:${JSON.stringify(params)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reads.push({ intent: matched.name, params });
    if (reads.length === MAX_READS) break;
  }
  const clarify = parsed.clarify?.trim();
  return clarify && reads.length === 0 ? { reads, clarify: clarify.slice(0, 200) } : { reads };
}
