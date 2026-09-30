import { describe, expect, it } from "vitest";

import { SwapChain } from "@circle-fin/app-kit";

import { conversionKitFromProvider, quoteConversion, swapChainFor, type ConversionKit } from "../src/index.js";

describe("conversion", () => {
  it("maps Arc chain ids to App Kit's own enum", () => {
    expect(swapChainFor(5_042_002)).toBe(SwapChain.Arc_Testnet);
    expect(swapChainFor(5_042)).toBe(SwapChain.Arc);
    expect(() => swapChainFor(1)).toThrow();
  });

  it("refuses pointless or empty conversions before calling Circle", async () => {
    const kit = { kit: { estimateSwap: () => Promise.reject(new Error("should not be called")) }, adapter: {}, chainId: 5_042_002 } as unknown as ConversionKit;
    expect(() => quoteConversion(kit, { tokenIn: "USDC", tokenOut: "USDC", amountIn: 1n })).toThrow(/nothing/);
    expect(() => quoteConversion(kit, { tokenIn: "USDC", tokenOut: "EURC", amountIn: 0n })).toThrow(/positive/);
  });

  it("passes amounts to Circle as exact decimal strings", async () => {
    let seen: unknown;
    const kit = { kit: { estimateSwap: async (p: unknown) => ((seen = p), {}) }, adapter: { id: "a" }, chainId: 5_042_002 } as unknown as ConversionKit;
    await quoteConversion(kit, { tokenIn: "USDC", tokenOut: "EURC", amountIn: 1_234_567n, slippageBps: 50 });
    expect(seen).toMatchObject({ tokenIn: "USDC", tokenOut: "EURC", amountIn: "1.234567", config: { slippageBps: 50 }, from: { chain: SwapChain.Arc_Testnet } });
  });

  it("builds a kit from an EIP-1193 provider", async () => {
    const mockProvider = {
      request: async ({ method }: { method: string }) => {
        if (method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x4cefa2";
        return null;
      },
      on: () => {},
      removeListener: () => {},
    };
    const kit = await conversionKitFromProvider(mockProvider, 5_042_002);
    expect(kit.chainId).toBe(5_042_002);
    expect(kit.kit).toBeDefined();
    expect(kit.adapter).toBeDefined();
  });
});
