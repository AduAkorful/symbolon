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
    const prod = { ...base, NODE_ENV: "production", APP_ORIGIN: "https://app.example.test", DATABASE_URL: "postgres://u:p@db.example.test/x", NEXT_PUBLIC_PRIVY_APP_ID: "app-id", PRIVY_APP_SECRET: "app-secret" };

    it("defaults to localhost and no database URL in development", () => {
      const c = loadConfig(base);
      expect(c.appOrigin).toBe("http://localhost:3000");
      expect(c.databaseUrl).toBeUndefined();
      expect(c.production).toBe(false);
      expect(c.privy).toBeUndefined();
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

    it("turns Privy sign-in on only when the app id and secret are both present, and reads the optional verification key", () => {
      expect(() => loadConfig({ ...base, NEXT_PUBLIC_PRIVY_APP_ID: "a" })).toThrow(/together/);
      expect(() => loadConfig({ ...base, PRIVY_APP_SECRET: "s" })).toThrow(/together/);
      expect(loadConfig({ ...base, NEXT_PUBLIC_PRIVY_APP_ID: "a", PRIVY_APP_SECRET: "s" }).privy).toEqual({ appId: "a", appSecret: "s" });
      expect(loadConfig({ ...base, NEXT_PUBLIC_PRIVY_APP_ID: "a", PRIVY_APP_SECRET: "s", PRIVY_JWT_VERIFICATION_KEY: "k" }).privy).toEqual({ appId: "a", appSecret: "s", verificationKey: "k" });
    });

    it("refuses production with no way to sign in, and Circle keys alone never open sign-in", () => {
      const { NEXT_PUBLIC_PRIVY_APP_ID: _a, PRIVY_APP_SECRET: _s, ...noPrivy } = prod;
      expect(() => loadConfig(noPrivy)).toThrow(/PRIVY/);
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "e" }).privy).toBeUndefined();
    });

    describe("the Steward's model (plan 05x X1)", () => {
      const modelOf = (extra: Record<string, string>) => loadConfig({ ...base, ...extra }).model;

      it("has no model until a key is set; blank keys count as unset", () => {
        expect(modelOf({})).toBeUndefined();
        expect(modelOf({ ANTHROPIC_API_KEY: "  ", OPENROUTER_API_KEY: "" })).toBeUndefined();
        expect("anthropicApiKey" in loadConfig(base)).toBe(false);
      });

      it("picks the one provider whose key is set", () => {
        expect(modelOf({ ANTHROPIC_API_KEY: " sk-a " })).toEqual({ provider: "anthropic", apiKey: "sk-a" });
        expect(modelOf({ OPENROUTER_API_KEY: "sk-or" })).toEqual({ provider: "openrouter", apiKey: "sk-or", model: "openai/gpt-6-luna", zdr: true });
      });

      it("refuses two keys without a selector, and a selector without its key", () => {
        expect(() => modelOf({ ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" })).toThrow(/STEWARD_LLM/);
        expect(() => modelOf({ STEWARD_LLM: "openrouter" })).toThrow(/OPENROUTER_API_KEY/);
        expect(() => modelOf({ STEWARD_LLM: "anthropic", OPENROUTER_API_KEY: "o" })).toThrow(/ANTHROPIC_API_KEY/);
        expect(() => modelOf({ STEWARD_LLM: "gemini", OPENROUTER_API_KEY: "o" })).toThrow(/STEWARD_LLM/);
      });

      it("lets the selector choose between two keys", () => {
        const both = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" };
        expect(modelOf({ ...both, STEWARD_LLM: "anthropic" })?.provider).toBe("anthropic");
        expect(modelOf({ ...both, STEWARD_LLM: " OpenRouter " })?.provider).toBe("openrouter");
      });

      it("reads the OpenRouter model slug and zero-data-retention setting, and refuses bad ones", () => {
        const or = { OPENROUTER_API_KEY: "o" };
        expect(modelOf({ ...or, OPENROUTER_MODEL: "google/gemini-3.1-flash-lite", OPENROUTER_ZDR: "false" })).toEqual({
          provider: "openrouter",
          apiKey: "o",
          model: "google/gemini-3.1-flash-lite",
          zdr: false,
        });
        expect(modelOf({ ...or, OPENROUTER_ZDR: "TRUE" })).toMatchObject({ zdr: true });
        for (const bad of ["gpt-6-luna", "openai/", "/luna", "openai/gpt 6", "https://evil.example/x/y", "openai/gpt-6\nX: y"]) {
          expect(() => modelOf({ ...or, OPENROUTER_MODEL: bad })).toThrow(/OPENROUTER_MODEL/);
        }
        expect(() => modelOf({ ...or, OPENROUTER_ZDR: "maybe" })).toThrow(/OPENROUTER_ZDR/);
      });

      it("never puts a key in an error message", () => {
        try {
          modelOf({ ANTHROPIC_API_KEY: "sk-secret-a", OPENROUTER_API_KEY: "sk-secret-o" });
        } catch (e) {
          expect(String(e)).not.toContain("sk-secret");
        }
      });
    });

    it("turns Steward wallets on only when the API key and the entity secret are both present", () => {
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k" }).stewardCircle).toBeUndefined();
      expect(loadConfig({ ...base, CIRCLE_ENTITY_SECRET: "s" }).stewardCircle).toBeUndefined();
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "s" }).stewardCircle).toEqual({ apiKey: "k", entitySecret: "s" });
      expect(loadConfig({ ...base, CIRCLE_API_KEY: "k", CIRCLE_ENTITY_SECRET: "s", CIRCLE_WALLET_SET_ID: "w" }).stewardCircle).toEqual({ apiKey: "k", entitySecret: "s", walletSetId: "w" });
    });
  });
});
