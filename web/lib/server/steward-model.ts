import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicStewardModel, type StewardModel } from "@symbolon/steward";
import { getConfig } from "./config";

let cached: StewardModel | undefined;

/** The Claude-backed reader, or null while there is no API key (the screens say reading uploads isn't available yet) */
export function getStewardModel(): StewardModel | null {
  const key = getConfig().anthropicApiKey;
  if (!key) return null;
  return (cached ??= new AnthropicStewardModel(new Anthropic({ apiKey: key })));
}
