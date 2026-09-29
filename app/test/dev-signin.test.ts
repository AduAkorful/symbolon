import { describe, expect, it } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { DEV_USERS, devSignInAllowed } from "@/lib/server/dev-signin";
import { loadConfig } from "@/lib/server/load-config";

const cfg = (over: Record<string, string>) => loadConfig({ CHAIN_ID: String(arcTestnet.id), ...over });

describe("dev sign-in gate", () => {
  it("exists in development on a testnet", () => {
    expect(devSignInAllowed(cfg({ NODE_ENV: "development" }))).toBe(true);
    expect(devSignInAllowed(cfg({}))).toBe(true);
  });

  it("does not exist in a production build, even on testnet", () => {
    const production = cfg({ NODE_ENV: "production", APP_ORIGIN: "https://app.example.test", DATABASE_URL: "postgres://x" });
    expect(devSignInAllowed(production)).toBe(false);
  });

  it("does not exist on mainnet", () => {
    // mainnet has no deployment yet, so a full config can't be built for it; the gate only reads these two fields
    expect(devSignInAllowed({ production: false, testnet: false })).toBe(false);
  });

  it("only signs in as reserved .test addresses", () => {
    for (const u of DEV_USERS) expect(u.email).toMatch(/@dev\.symbolon\.test$/);
  });
});
