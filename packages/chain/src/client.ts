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
  // Reads made in the same moment travel as one Multicall3 request: a page that reads the Vault for several invoices at once
  // would otherwise send dozens of requests to a public RPC. Only plain reads are batched; a call with a sender (every
  // simulation) goes on its own, as before.
  return createPublicClient({ chain, transport, batch: { multicall: true } }) as PublicClient;
}
