import { arcChain } from "@symbolon/chain";
import type { ChainParams, SignerPlan } from "@/components/setup/owner-signer";
import type { AppConfig } from "./load-config";
import { devSignInAllowed } from "./dev-signin";
import type { SessionUser } from "./session";

// What the person signs with on this screen (plan 05h, H4). Decided on the server, from how they signed in; the browser is told, not asked.

export function chainParams(chainId: number): ChainParams {
  const c = arcChain(chainId);
  return {
    chainIdHex: `0x${c.id.toString(16)}`,
    name: c.name,
    currency: c.nativeCurrency,
    rpcUrls: [...c.rpcUrls.default.http],
    explorerUrl: c.blockExplorers!.default.url,
  };
}

export function signerPlanFor(session: { method: string; user: Pick<SessionUser, "wallet"> }, config: AppConfig): SignerPlan {
  const { wallet } = session.user;
  if (session.method === "dev" && devSignInAllowed(config) && wallet) return { kind: "dev", address: wallet };
  if (session.method === "wallet" && wallet) return { kind: "wallet", address: wallet, chain: chainParams(config.chainId) };
  return { kind: "none", reason: "This account signs in with an email wallet, which can’t send transactions from here yet. Sign in with a wallet to do this." };
}
