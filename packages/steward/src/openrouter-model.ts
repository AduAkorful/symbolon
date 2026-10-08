import { z } from "zod";

import { extractionSchema, ModelRefusal, type Extraction, type IntentDescriptor, type PhraseInput, type PlanResult, type RouteResult, type RouteTurn, type StewardModel } from "./model.js";
import { EXPLAIN_SYSTEM, EXTRACT_SYSTEM, phraseSystem, phraseUser, planSystem, routeSystem } from "./prompts.js";
import type { DecisionRecord } from "./records.js";
import { planSchemaFor, routeSchemaFor, toPlanResult, toRouteResult } from "./route-schema.js";

// Plan 05x. The Steward's reader on OpenRouter's chat-completions API, over plain fetch. Like the Claude-backed model it only
// reads and explains; nothing here can sign, send, or change a setting, and its output is validated by our own schemas.

/** OpenRouter's OpenAI-compatible endpoint (docs: openrouter.ai/docs, observed working 2026-10-06) */
export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

type Job = "extract" | "explain" | "route" | "plan" | "phrase";

export interface OpenRouterOptions {
  apiKey: string;
  /** An OpenRouter model slug, e.g. "openai/gpt-6-luna" */
  model: string;
  /** Route only to providers with zero data retention. Data collection is always denied. */
  zdr: boolean;
  fetch?: typeof fetch;
  /** One line per call: job, model, status, time, cost and token counts. Never content, never the key. */
  log?: (line: Record<string, unknown>) => void;
  timeoutsMs?: Partial<Record<Job, number>>;
  retryDelayMs?: number;
}

/** OpenRouter (or the network to it) failed. status 0 = no HTTP answer (network failure or timeout). */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string | number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

const DEFAULT_TIMEOUTS: Record<Job, number> = { extract: 75_000, explain: 20_000, route: 15_000, plan: 9_000, phrase: 9_000 };
const RETRYABLE = new Set([429, 502, 503, 504]);

interface Choice {
  finish_reason?: string | null;
  message?: { content?: unknown; refusal?: unknown };
}
interface Completion {
  choices?: Choice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: string | number; message?: unknown };
}

export class OpenRouterStewardModel implements StewardModel {
  private readonly fetchFn: typeof fetch;
  private readonly log: (line: Record<string, unknown>) => void;
  private readonly timeouts: Record<Job, number>;
  private readonly retryDelayMs: number;

  constructor(private readonly opts: OpenRouterOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.log = opts.log ?? ((line) => console.info("steward model call", line));
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeoutsMs };
    this.retryDelayMs = opts.retryDelayMs ?? 1_500;
  }

  async extractInvoice(input: { pdfBase64?: string; text?: string }): Promise<Extraction> {
    if (!input.pdfBase64 && !input.text) throw new Error("nothing to read");
    const parts: unknown[] = [];
    if (input.text) parts.push({ type: "text", text: `<invoice_document>\n${input.text}\n</invoice_document>` });
    parts.push({ type: "text", text: "Extract this invoice." });
    if (input.pdfBase64) {
      parts.push({ type: "file", file: { filename: "invoice.pdf", file_data: `data:application/pdf;base64,${input.pdfBase64}` } });
    }
    const choice = await this.call("extract", {
      max_tokens: 6_000,
      response_format: { type: "json_schema", json_schema: { name: "extraction", strict: true, schema: z.toJSONSchema(extractionSchema) } },
      // always the model's own PDF reader: the free engines made a model invent an invoice from a scan
      ...(input.pdfBase64 ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {}),
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: parts },
      ],
    });
    return extractionSchema.parse(parseJson(contentOf(choice)));
  }

  async explain(record: DecisionRecord): Promise<string> {
    const choice = await this.call("explain", {
      max_tokens: 600,
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM },
        { role: "user", content: `<decision_record>\n${JSON.stringify(record)}\n</decision_record>` },
      ],
    });
    const text = contentOf(choice).trim();
    if (!text) throw new Error("the model returned no explanation");
    return text;
  }

  async route(question: string, intents: IntentDescriptor[], history?: RouteTurn[]): Promise<RouteResult> {
    const schema = routeSchemaFor(intents);
    let choice: Choice;
    try {
      choice = await this.call("route", {
        max_tokens: 400,
        response_format: { type: "json_schema", json_schema: { name: "route", strict: true, schema: z.toJSONSchema(schema) } },
        messages: [
          { role: "system", content: routeSystem(intents, history) },
          { role: "user", content: question },
        ],
      });
    } catch (e) {
      if (e instanceof ModelRefusal) return { intent: "unsupported", reason: "Question declined." };
      throw e;
    }
    let content: string;
    try {
      content = contentOf(choice);
    } catch (e) {
      if (e instanceof ModelRefusal) return { intent: "unsupported", reason: "Question declined." };
      throw e;
    }
    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(content));
    } catch {
      return { intent: "unsupported", reason: "Could not route question." };
    }
    if (!parsed.success) return { intent: "unsupported", reason: "Could not route question." };
    return toRouteResult(parsed.data, intents);
  }

  async plan(question: string, intents: IntentDescriptor[], history?: RouteTurn[]): Promise<PlanResult> {
    const schema = planSchemaFor(intents);
    let content: string;
    try {
      const choice = await this.call("plan", {
        max_tokens: 500,
        response_format: { type: "json_schema", json_schema: { name: "plan", strict: true, schema: z.toJSONSchema(schema) } },
        messages: [
          { role: "system", content: planSystem(intents, history) },
          { role: "user", content: question },
        ],
      });
      content = contentOf(choice);
    } catch (e) {
      if (e instanceof ModelRefusal) return { reads: [] };
      throw e;
    }
    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(content));
    } catch {
      return { reads: [] };
    }
    return parsed.success ? toPlanResult(parsed.data, intents) : { reads: [] };
  }

  async phrase(input: PhraseInput): Promise<string> {
    const choice = await this.call("phrase", {
      max_tokens: 500,
      messages: [
        { role: "system", content: phraseSystem() },
        { role: "user", content: phraseUser(input) },
      ],
    });
    const text = contentOf(choice).trim();
    if (!text) throw new Error("the model returned no reply");
    return text;
  }

  /** One chat completion with the shared request fields, one retry on a transient failure, and a log line either way */
  private async call(job: Job, request: Record<string, unknown>): Promise<Choice> {
    const body = JSON.stringify({
      model: this.opts.model,
      reasoning: { enabled: false },
      usage: { include: true },
      // require_parameters stops OpenRouter routing to a provider that would ignore the strict schema
      provider: { require_parameters: true, data_collection: "deny", zdr: this.opts.zdr },
      ...request,
    });
    const started = Date.now();
    const deadline = started + this.timeouts[job];
    const fail = (status: number, message: string, code?: string | number): never => {
      this.log({ job, model: this.opts.model, status, ms: Date.now() - started, cost: null, inputTokens: null, outputTokens: null, error: message.slice(0, 200) });
      throw new OpenRouterError(`OpenRouter request failed (${status ? `HTTP ${status}` : message})${status ? `: ${message.slice(0, 200)}` : ""}`, status, code);
    };

    for (let attempt = 1; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return fail(0, "model request timed out");
      let status: number;
      let json: Completion | null;
      try {
        const res = await this.fetchFn(OPENROUTER_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(remaining),
        });
        status = res.status;
        json = (await res.json().catch(() => null)) as Completion | null;
      } catch (e) {
        const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
        if (aborted) return fail(0, "model request timed out");
        if (attempt === 1) {
          await delay(this.retryDelayMs);
          continue;
        }
        return fail(0, "could not reach the model service");
      }

      // OpenRouter can answer HTTP 200 with an error body when the provider fails after accepting the request
      const bodyCode = json?.error?.code;
      // an HTTP 200 with no answer at all is the provider failing quietly; treat it like a 502 (retried once)
      const failedStatus = status >= 400 ? status : json?.error ? (typeof bodyCode === "number" && bodyCode >= 400 ? bodyCode : 502) : json?.choices?.length ? 0 : 502;
      if (failedStatus) {
        if (attempt === 1 && RETRYABLE.has(failedStatus)) {
          await delay(this.retryDelayMs);
          continue;
        }
        const message = typeof json?.error?.message === "string" ? json.error.message : status < 400 ? "the model returned no answer" : "no detail";
        return fail(failedStatus, message, bodyCode);
      }

      this.log({
        job,
        model: this.opts.model,
        status,
        ms: Date.now() - started,
        cost: json?.usage?.cost ?? null,
        inputTokens: json?.usage?.prompt_tokens ?? null,
        outputTokens: json?.usage?.completion_tokens ?? null,
      });
      const choice = json?.choices?.[0];
      if (!choice) throw new Error("the model returned no answer");
      return choice;
    }
  }
}

const delay = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** The answer text, or a refusal. A truncated or errored answer is never read: a partial JSON must not become a draft. */
function contentOf(choice: Choice): string {
  if (choice.message?.refusal || choice.finish_reason === "content_filter") throw new ModelRefusal(null);
  if (choice.finish_reason === "length" || choice.finish_reason === "error" || choice.finish_reason === "tool_calls") {
    throw new Error(`the model stopped early (${choice.finish_reason})`);
  }
  const c = choice.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  throw new Error("the model returned no text");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("the model's answer was not valid JSON");
  }
}
