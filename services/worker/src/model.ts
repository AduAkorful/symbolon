import Anthropic from "@anthropic-ai/sdk";

import type { AppConfig } from "@symbolon/config";
import { AnthropicStewardModel, OpenRouterStewardModel, type StewardModel } from "@symbolon/steward";

let cached: StewardModel | undefined;
let cachedKey: string | undefined;

/** The configured reader, or undefined while no model key is set. Explanations are skipped; payments do not use it. */
export function stewardModel(cfg: AppConfig): StewardModel | undefined {
  const m = cfg.model;
  if (!m) return undefined;
  const key = m.provider === "anthropic" ? m.apiKey : `${m.apiKey}:${m.model}`;
  if (cached && cachedKey === key) return cached;
  cachedKey = key;
  cached = m.provider === "anthropic"
    ? new AnthropicStewardModel(new Anthropic({ apiKey: m.apiKey }))
    : new OpenRouterStewardModel({ apiKey: m.apiKey, model: m.model, zdr: m.zdr });
  return cached;
}
