import { arcChain } from "@symbolon/chain";
import type { ChainParams, SignerPlan } from "@/components/setup/owner-signer";
import type { AppConfig } from "./load-config";
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

export function signerPlanFor(session: { user: Pick<SessionUser, "wallet"> }, config: AppConfig): SignerPlan {
  const { wallet } = session.user;
  // The wallet on the account is fixed when the account is made (plan 05k, P4); the browser must produce a provider for exactly it
  if (wallet) return { kind: "wallet", address: wallet, chain: chainParams(config.chainId) };
  return { kind: "none", reason: "This account has no wallet yet. Sign in again." };
}
