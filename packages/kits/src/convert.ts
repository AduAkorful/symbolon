import { AppKit, SwapChain, type SwapEstimate, type SwapParams, type SwapResult } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, createWalletClient, fallback, formatUnits, http, type Address, type Hex } from "viem";

import { arcChain, arcMainnet, arcTestnet } from "@symbolon/chain";

/**
 * USDC ⇄ EURC conversion with Circle's Swap Kit (App Kit), on the payer's side before funding the Vault (plan 14):
 * the Vault never swaps. An API key is optional for Swap (SDK 1.15.3 types; `kitKey` is a deprecated alias).
 */
export type FxToken = "USDC" | "EURC";

const DECIMALS = 6;

/** App Kit's own chain enum (distinct from Circle Wallets' `ARC-TESTNET` strings) */
export function swapChainFor(chainId: number): SwapChain {
  if (chainId === arcTestnet.id) return SwapChain.Arc_Testnet;
  if (chainId === arcMainnet.id) return SwapChain.Arc;
  throw new Error(`no Swap Kit chain for ${chainId}`);
}

export interface ConversionKit {
  kit: AppKit;
  adapter: SwapParams["from"]["adapter"];
  /** Required for adapters without a single connected wallet (e.g. Circle developer-controlled wallets) */
  address?: Address;
  chainId: number;
}

/** A server-side kit signing with a local key, pinned to the docs.arc.io RPCs */
export function conversionKitFromPrivateKey(privateKey: Hex, chainId: number): ConversionKit {
  const chain = arcChain(chainId);
  const transport = fallback(chain.rpcUrls.default.http.map((u) => http(u)));
  const adapter = createViemAdapterFromPrivateKey({
    privateKey,
    getPublicClient: () => createPublicClient({ chain, transport }) as never,
    getWalletClient: ({ account }) => createWalletClient({ chain, account, transport }),
  });
  return { kit: new AppKit(), adapter: adapter as never, chainId };
}

export interface ConversionRequest {
  tokenIn: FxToken;
  tokenOut: FxToken;
  /** Raw units (6 decimals) */
  amountIn: bigint;
  slippageBps?: number;
  apiKey?: string;
}

function params(k: ConversionKit, r: ConversionRequest): SwapParams {
  if (r.tokenIn === r.tokenOut) throw new Error("nothing to convert");
  if (r.amountIn <= 0n) throw new Error("amount must be positive");
  const chain = swapChainFor(k.chainId);
  const from = k.address ? { adapter: k.adapter, chain, address: k.address } : { adapter: k.adapter, chain };
  return {
    from,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    amountIn: formatUnits(r.amountIn, DECIMALS),
    config: { ...(r.slippageBps !== undefined ? { slippageBps: r.slippageBps } : {}), ...(r.apiKey ? { apiKey: r.apiKey } : {}) },
  } as SwapParams;
}

/**
 * A quote only: no funds move. Balance-agnostic (Contraflow's live finding, 2026-09): check the wallet's balance
 * separately before offering to convert.
 */
export function quoteConversion(k: ConversionKit, r: ConversionRequest): Promise<SwapEstimate> {
  return k.kit.estimateSwap(params(k, r));
}

/** Executes the conversion from the kit's wallet */
export function convert(k: ConversionKit, r: ConversionRequest): Promise<SwapResult> {
  return k.kit.swap(params(k, r));
}
