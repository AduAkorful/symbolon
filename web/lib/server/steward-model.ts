import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicStewardModel, OpenRouterStewardModel, type StewardModel } from "@symbolon/steward";
import { getConfig } from "./config";

let cached: StewardModel | undefined;

/** The configured reader (Claude, or an OpenRouter-hosted model; plan 05x), or null while no model key is set (the screens say it isn't available yet) */
export function getStewardModel(): StewardModel | null {
  const m = getConfig().model;
  if (!m) return null;
  return (cached ??= m.provider === "anthropic"
    ? new AnthropicStewardModel(new Anthropic({ apiKey: m.apiKey }))
    : new OpenRouterStewardModel({ apiKey: m.apiKey, model: m.model, zdr: m.zdr }));
}
