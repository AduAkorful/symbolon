import "server-only";
import { createArcClient } from "@symbolon/chain";
import type { PublicClient } from "viem";
import { getConfig } from "./config";

let cached: PublicClient | undefined;

/** The read client for the configured chain (docs.arc.io RPCs with fallback, unless ARC_RPC_URL is set) */
export function getClient(): PublicClient {
  const { chainId, rpcUrl } = getConfig();
  return (cached ??= createArcClient(chainId, rpcUrl));
}
