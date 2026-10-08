import { defineChain, type Chain } from "viem";
import { arc as viemArc, arcTestnet as viemArcTestnet } from "viem/chains";

// viem's Arc definitions carry stale URLs (arc.network, arcscan.app). Only the chain IDs and native currency are
// taken from them; RPC and explorer URLs come from docs.arc.io/arc/references/connect-to-arc (checked 2026-09-26).
export const arcTestnet = defineChain({
  id: viemArcTestnet.id,
  name: "Arc Testnet",
  nativeCurrency: viemArcTestnet.nativeCurrency,
  rpcUrls: {
    default: {
      http: [
        "https://rpc.testnet.arc.io",
        "https://rpc.blockdaemon.testnet.arc.io",
        "https://rpc.drpc.testnet.arc.io",
        "https://rpc.quicknode.testnet.arc.io",
      ],
      webSocket: ["wss://rpc.testnet.arc.io"],
    },
  },
  blockExplorers: {
    default: { name: "Arc Testnet Explorer", url: "https://explorer.testnet.arc.io", apiUrl: "https://explorer.testnet.arc.io/api" },
  },
  // Multicall3 sits at the standard address on Arc (code present on both networks, checked with cast 2026-10-08); viem's own
  // definition carries it, so reads can be batched into one request (client.ts)
  contracts: viemArcTestnet.contracts,
  testnet: true,
});

export const arcMainnet = defineChain({
  id: viemArc.id,
  name: "Arc",
  nativeCurrency: viemArc.nativeCurrency,
  rpcUrls: {
    default: {
      http: [
        "https://rpc.mainnet.arc.io",
        "https://rpc.blockdaemon.mainnet.arc.io",
        "https://rpc.drpc.mainnet.arc.io",
        "https://rpc.quicknode.mainnet.arc.io",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io", apiUrl: "https://explorer.arc.io/api" },
  },
  contracts: viemArc.contracts,
});

const CHAINS: Record<number, Chain> = { [arcTestnet.id]: arcTestnet, [arcMainnet.id]: arcMainnet };

export function arcChain(chainId: number): Chain {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`unsupported chain ${chainId}; Symbolon runs on Arc (${Object.keys(CHAINS).join(", ")})`);
  return chain;
}

export function explorerTxUrl(chainId: number, hash: string): string {
  return `${arcChain(chainId).blockExplorers?.default.url}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${arcChain(chainId).blockExplorers?.default.url}/address/${address}`;
}
