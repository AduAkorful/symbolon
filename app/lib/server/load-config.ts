import { arcChain, getDeployment, type Deployment } from "@symbolon/chain";

/** A setting is missing or wrong. Thrown at startup so the app never runs against a chain it wasn't told about. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  chainId: number;
  testnet: boolean;
  /** Optional RPC override; unset uses the docs.arc.io endpoints with fallback */
  rpcUrl?: string;
  /** Every contract address comes from here (the generated deployment registry), never from env or code */
  deployment: Deployment;
  /** Where the app is served (scheme + host). Sign-in messages and POST origin checks are pinned to it. */
  appOrigin: string;
  production: boolean;
  /** Postgres URL; unset only in development, where the app uses an on-disk PGlite instead */
  databaseUrl?: string;
  /** Circle user-controlled wallets (email sign-in). Absent until both values are set. */
  circle?: { apiKey: string; appId: string };
  /** Circle developer-controlled wallets (Steward wallets). Absent until the API key and the entity secret are both set. */
  stewardCircle?: { apiKey: string; entitySecret: string; walletSetId?: string };
  /** Claude, for reading uploaded invoices into a draft (never on a payment path). Absent until the key is set. */
  anthropicApiKey?: string;
}

type Env = Record<string, string | undefined>;

/** Reads and checks the settings the app needs. Pure: takes the environment as an argument so it can be tested. */
export function loadConfig(env: Env): AppConfig {
  const raw = env.CHAIN_ID;
  if (raw === undefined || raw === "") throw new ConfigError("CHAIN_ID is not set (5042002 for Arc testnet); the app won't guess a chain");
  if (!/^[1-9][0-9]*$/.test(raw)) throw new ConfigError(`CHAIN_ID must be a positive integer, got ${JSON.stringify(raw)}`);
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId)) throw new ConfigError(`CHAIN_ID is out of range: ${raw}`);

  // Both throw a named error: unsupported chain, or a supported chain nothing is deployed on yet
  const chain = arcChain(chainId);
  const deployment = getDeployment(chainId);

  const rpc = env.ARC_RPC_URL?.trim();
  let rpcUrl: string | undefined;
  if (rpc) {
    let url: URL;
    try {
      url = new URL(rpc);
    } catch {
      throw new ConfigError("ARC_RPC_URL is not a valid URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError("ARC_RPC_URL must be an http(s) URL");
    rpcUrl = rpc;
  }

  const production = env.NODE_ENV === "production";
  const testnet = chain.testnet === true;

  const origin = env.APP_ORIGIN?.trim();
  if (!origin && production) throw new ConfigError("APP_ORIGIN is not set; sign-in is pinned to the address the app is served from");
  let appOrigin: string;
  try {
    appOrigin = new URL(origin || "http://localhost:3000").origin;
  } catch {
    throw new ConfigError("APP_ORIGIN is not a valid URL");
  }
  if (production && !appOrigin.startsWith("https://")) throw new ConfigError("APP_ORIGIN must be https in production");

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (!databaseUrl && production) throw new ConfigError("DATABASE_URL is not set; production never falls back to a throwaway database");

  const apiKey = env.CIRCLE_API_KEY?.trim();
  const appId = env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
  const entitySecret = env.CIRCLE_ENTITY_SECRET?.trim();
  const walletSetId = env.CIRCLE_WALLET_SET_ID?.trim();
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim();

  return {
    chainId,
    testnet,
    ...(rpcUrl ? { rpcUrl } : {}),
    deployment,
    appOrigin,
    production,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(apiKey && appId ? { circle: { apiKey, appId } } : {}),
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(apiKey && entitySecret ? { stewardCircle: { apiKey, entitySecret, ...(walletSetId ? { walletSetId } : {}) } } : {}),
  };
}
