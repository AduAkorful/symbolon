"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";
import { useMemo, type ReactNode } from "react";
import type { ChainParams } from "@/components/setup/owner-signer";
import { ConnectWalletProvider } from "@/components/wallet/ConnectWalletContext";

/**
 * Privy for this page (plan 05k, P5, P8). The chain comes from the deployment registry through the server (never viem's built-in
 * Arc entry, whose URLs are stale). Login is email and wallet only; people without a wallet get an embedded one.
 *
 * The config object is memoised: a new one on every render can make Privy drop the session it just restored.
 */
export function PrivyRoot({ appId, chain, children }: { appId: string; chain: ChainParams; children: ReactNode }) {
  const chainId = Number(chain.chainIdHex);
  const { name, explorerUrl } = chain;
  const { name: currencyName, symbol: currencySymbol, decimals: currencyDecimals } = chain.currency;
  const rpcUrls = chain.rpcUrls.join("\n");
  const arc = useMemo(
    () =>
      defineChain({
        id: chainId,
        name,
        nativeCurrency: { name: currencyName, symbol: currencySymbol, decimals: currencyDecimals },
        rpcUrls: { default: { http: rpcUrls.split("\n") } },
        blockExplorers: { default: { name: "Explorer", url: explorerUrl } },
      }),
    [chainId, name, currencyName, currencySymbol, currencyDecimals, explorerUrl, rpcUrls],
  );
  const config = useMemo(
    () => ({
      loginMethods: ["email", "wallet"] as Array<"email" | "wallet">,
      appearance: { theme: "dark" as const, accentColor: "#9FB0F5" as const, walletChainType: "ethereum-only" as const },
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" as const } },
      defaultChain: arc,
      supportedChains: [arc],
    }),
    [arc],
  );
  return (
    <PrivyProvider appId={appId} config={config}>
      <ConnectWalletProvider>{children}</ConnectWalletProvider>
    </PrivyProvider>
  );
}
