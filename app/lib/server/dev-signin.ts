import type { AppConfig } from "./load-config";

// Plan 05g, S6. The one place that decides whether the dev sign-in exists: development builds on a testnet, nowhere else.
// A deployed testnet app runs with NODE_ENV=production, so it doesn't get it either.
export function devSignInAllowed(config: Pick<AppConfig, "production" | "testnet">): boolean {
  return !config.production && config.testnet;
}

/** Reserved .test addresses: nothing real can ever be delivered to them */
export const DEV_USERS = [
  { key: "owner", label: "A business owner", email: "owner@dev.symbolon.test" },
  { key: "vendor", label: "A vendor", email: "vendor@dev.symbolon.test" },
] as const;

export type DevUserKey = (typeof DEV_USERS)[number]["key"];
