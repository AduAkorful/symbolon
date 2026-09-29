import { circleBlockchain } from "@symbolon/steward";
import { AuthError } from "./errors";

// Circle user-controlled wallets: email sign-in. Endpoints and shapes are from developers.circle.com (Build a wallet app →
// Email OTP, and the List wallets reference), read 2026-09-29. The browser finishes the code step in Circle's own window; this
// server side only asks Circle to send the code, and checks the user token the browser ends up with.

export { circleBlockchain };

/** D4 (plan 05f): an EOA can sign typed data straight away; a smart-contract wallet must first make an onchain transaction */
export const ACCOUNT_TYPE = "EOA";

export interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  userId: string;
  accountType: string;
}

export interface CircleAuth {
  /** Circle emails the code (its SMTP settings) and returns the session values the browser SDK needs */
  requestEmailOtp(a: { deviceId: string; email: string }): Promise<{ deviceToken: string; deviceEncryptionKey: string; otpToken: string }>;
  /** Makes the user's wallet: returns the challenge the browser runs, or says the user already has one */
  initializeUser(userToken: string, chainId: number): Promise<{ challengeId: string } | { alreadyInitialized: true }>;
  /** Also how a user token is checked: Circle refuses an invalid or expired one */
  listWallets(userToken: string): Promise<CircleWallet[]>;
}

const BASE = "https://api.circle.com";
/** Circle's code for "this user already has a wallet" (docs, Email OTP tutorial) */
const ALREADY_INITIALIZED = 155106;
const TIMEOUT_MS = 10_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function createCircleAuth(cfg: { apiKey: string; baseUrl?: string }, fetchImpl: typeof fetch = fetch): CircleAuth {
  const base = cfg.baseUrl ?? BASE;

  async function call(path: string, init: { method: "GET" | "POST"; userToken?: string; body?: unknown }): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
          ...(init.userToken ? { "X-User-Token": init.userToken } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new AuthError(502, "Can't reach the sign-in service right now. Try again in a moment.");
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  }

  return {
    async requestEmailOtp({ deviceId, email }) {
      const r = await call("/v1/w3s/users/email/token", { method: "POST", body: { idempotencyKey: crypto.randomUUID(), deviceId, email } });
      if (!r.ok) throw new AuthError(r.status === 400 ? 400 : 502, r.status === 400 ? "Circle didn't accept that email address." : "The sign-in service couldn't send a code. Try again.");
      const d = (r.json.data ?? {}) as Record<string, unknown>;
      const out = { deviceToken: str(d.deviceToken), deviceEncryptionKey: str(d.deviceEncryptionKey), otpToken: str(d.otpToken) };
      if (!out.deviceToken || !out.deviceEncryptionKey || !out.otpToken) throw new AuthError(502, "The sign-in service answered in a way we don't recognise.");
      return out;
    },

    async initializeUser(userToken, chainId) {
      const r = await call("/v1/w3s/user/initialize", {
        method: "POST",
        userToken,
        body: { idempotencyKey: crypto.randomUUID(), accountType: ACCOUNT_TYPE, blockchains: [circleBlockchain(chainId)] },
      });
      if (!r.ok) {
        if (r.json.code === ALREADY_INITIALIZED) return { alreadyInitialized: true };
        if (r.status === 401) throw new AuthError(401, "That sign-in has expired. Start again.");
        throw new AuthError(502, "The sign-in service couldn't set up your wallet. Try again.");
      }
      const challengeId = str(((r.json.data ?? {}) as Record<string, unknown>).challengeId);
      if (!challengeId) throw new AuthError(502, "The sign-in service answered in a way we don't recognise.");
      return { challengeId };
    },

    async listWallets(userToken) {
      const r = await call("/v1/w3s/wallets", { method: "GET", userToken });
      if (r.status === 401) throw new AuthError(401, "That sign-in isn't valid or has expired. Start again.");
      if (!r.ok) throw new AuthError(502, "Can't check your sign-in right now. Try again in a moment.");
      const list = (((r.json.data ?? {}) as Record<string, unknown>).wallets ?? []) as Record<string, unknown>[];
      return list.map((w) => ({
        id: str(w.id),
        address: str(w.address).toLowerCase(),
        blockchain: str(w.blockchain),
        state: str(w.state),
        userId: str(w.userId),
        accountType: str(w.accountType),
      }));
    },
  };
}
