import "server-only";
import { loadConfig, type AppConfig } from "./load-config";

let cached: AppConfig | undefined;

/** The validated app config, read once. Throws a ConfigError if the environment is wrong. */
export function getConfig(): AppConfig {
  return (cached ??= loadConfig(process.env));
}
