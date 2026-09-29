import { describe, expect, it } from "vitest";
import { arcMainnet, arcTestnet, getDeployment } from "@symbolon/chain";
import { ConfigError, loadConfig } from "@/lib/server/load-config";

const base = { CHAIN_ID: String(arcTestnet.id) };

describe("loadConfig", () => {
  it("returns the registry deployment for the configured chain", () => {
    const c = loadConfig(base);
    expect(c.chainId).toBe(arcTestnet.id);
    expect(c.testnet).toBe(true);
    expect(c.rpcUrl).toBeUndefined();
    expect(c.deployment).toEqual(getDeployment(arcTestnet.id));
  });

  it("refuses to start without CHAIN_ID rather than guessing a chain", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/CHAIN_ID/);
    expect(() => loadConfig({ CHAIN_ID: "" })).toThrow(/CHAIN_ID/);
  });

  it.each(["abc", "1.5", "-1", "0x13a", "5042002 "])("rejects a malformed CHAIN_ID (%j)", (v) => {
    expect(() => loadConfig({ CHAIN_ID: v })).toThrow(/CHAIN_ID/);
  });

  it("rejects a chain Symbolon doesn't run on", () => {
    expect(() => loadConfig({ CHAIN_ID: "1" })).toThrow(/unsupported chain/);
  });

  it("rejects a supported chain that has no deployment registry yet", () => {
    // mainnet is a supported chain but nothing is deployed there until step 17
    expect(() => loadConfig({ CHAIN_ID: String(arcMainnet.id) })).toThrow(/no Symbolon deployment/);
  });

  it("treats an empty ARC_RPC_URL as unset (the example env file leaves it blank)", () => {
    expect(loadConfig({ ...base, ARC_RPC_URL: "" }).rpcUrl).toBeUndefined();
  });

  it("accepts an http(s) RPC override and rejects anything else", () => {
    expect(loadConfig({ ...base, ARC_RPC_URL: "https://rpc.example.test" }).rpcUrl).toBe("https://rpc.example.test");
    expect(() => loadConfig({ ...base, ARC_RPC_URL: "not a url" })).toThrow(/ARC_RPC_URL/);
    expect(() => loadConfig({ ...base, ARC_RPC_URL: "ftp://rpc.example.test" })).toThrow(/ARC_RPC_URL/);
  });

  describe("sign-in settings", () => {
    const prod = { ...base, NODE_ENV: "production", APP_ORIGIN: "https://app.example.test", DATABASE_URL: "postgres://u:p@db.example.test/x" };

    it("defaults to localhost and no database URL in development", () => {
      const c = loadConfig(base);
      expect(c.appOrigin).toBe("http://localhost:3000");
      expect(c.databaseUrl).toBeUndefined();
      expect(c.production).toBe(false);
      expect(c.circle).toBeUndefined();
    });

    it("normalises APP_ORIGIN to a bare origin", () => {
      expect(loadConfig({ ...base, APP_ORIGIN: "http://127.0.0.1:3000/somewhere?x=1" }).appOrigin).toBe("http://127.0.0.1:3000");
      expect(() => loadConfig({ ...base, APP_ORIGIN: "not a url" })).toThrow(/APP_ORIGIN/);
    });

    it("refuses production without an origin, without https, or without a database", () => {
      expect(loadConfig(prod).production).toBe(true);
      const { APP_ORIGIN: _o, ...noOrigin } = prod;
      expect(() => loadConfig(noOrigin)).toThrow(/APP_ORIGIN/);
      expect(() => loadConfig({ ...prod, APP_ORIGIN: "http://app.example.test" })).toThrow(/https/);
      const { DATABASE_URL: _d, ...noDb } = prod;
      expect(() => loadConfig(noDb)).toThrow(/DATABASE_URL/);
    });

    it("turns email sign-in on only when both Circle values are present", () => {
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k" }).circle).toBeUndefined();
      expect(loadConfig({ ...base, NEXT_PUBLIC_CIRCLE_APP_ID: "a" }).circle).toBeUndefined();
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", NEXT_PUBLIC_CIRCLE_APP_ID: "a" }).circle).toEqual({ apiKey: "k", appId: "a" });
    });

    it("reads the Anthropic key only when it is set", () => {
      expect(loadConfig(base).anthropicApiKey).toBeUndefined();
      expect(loadConfig({ ...base, ANTHROPIC_API_KEY: "  " }).anthropicApiKey).toBeUndefined();
      expect(loadConfig({ ...base, ANTHROPIC_API_KEY: "sk-test" }).anthropicApiKey).toBe("sk-test");
    });

    it("turns Steward wallets on only when the API key and the entity secret are both present", () => {
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k" }).stewardCircle).toBeUndefined();
      expect(loadConfig({ ...base, CIRCLE_ENTITY_SECRET: "s" }).stewardCircle).toBeUndefined();
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "s" }).stewardCircle).toEqual({ apiKey: "k", entitySecret: "s" });
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "s", CIRCLE_WALLET_SET_ID: "w" }).stewardCircle).toEqual({ apiKey: "k", entitySecret: "s", walletSetId: "w" });
    });
  });
});
