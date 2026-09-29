import { createPublicClient, fallback, http, type PublicClient } from "viem";

import { arcChain } from "./chains.js";

/**
 * A read client for Arc. Uses the docs.arc.io RPCs with fallback unless `rpcUrl` is given.
 * All simulations run on the node (`eth_call`): Arc's USDC moves balances through a native precompile that local EVMs
 * can't execute.
 */
export function createArcClient(chainId: number, rpcUrl?: string): PublicClient {
  const chain = arcChain(chainId);
  const transport = rpcUrl ? http(rpcUrl) : fallback(chain.rpcUrls.default.http.map((url) => http(url)));
  return createPublicClient({ chain, transport }) as PublicClient;
}
