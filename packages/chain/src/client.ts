import { createPublicClient, type PublicClient } from "viem";

import { arcChain } from "./chains.js";
import { poolTransport } from "./rpc-pool.js";

/**
 * A read client for Arc. Uses the docs.arc.io RPCs together as one pool (see `rpc-pool.ts`) unless `rpcUrl` is given: a single
 * URL, or several separated by commas.
 * All simulations run on the node (`eth_call`): Arc's USDC moves balances through a native precompile that local EVMs
 * can't execute.
 */
export function createArcClient(chainId: number, rpcUrl?: string): PublicClient {
  const chain = arcChain(chainId);
  const urls = rpcUrl ? rpcUrl.split(",").map((u) => u.trim()).filter(Boolean) : chain.rpcUrls.default.http;
  // Reads made in the same moment travel as one Multicall3 request: a page that reads the Vault for several invoices at once
  // would otherwise send dozens of requests to a public RPC. Only plain reads are batched; a call with a sender (every
  // simulation) goes on its own, as before.
  return createPublicClient({ chain, transport: poolTransport([...urls]), batch: { multicall: true } }) as PublicClient;
}
