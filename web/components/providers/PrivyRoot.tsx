"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";
import type { ReactNode } from "react";
import type { ChainParams } from "@/components/setup/owner-signer";
import { ConnectWalletProvider } from "@/components/wallet/ConnectWalletContext";

/**
 * Privy for this page (plan 05k, P5, P8). The chain comes from the deployment registry through the server (never viem's built-in
 * Arc entry, whose URLs are stale). Login is email and wallet only; people without a wallet get an embedded one.
 */
export function PrivyRoot({ appId, chain, children }: { appId: string; chain: ChainParams; children: ReactNode }) {
  const arc = defineChain({
    id: Number(chain.chainIdHex),
    name: chain.name,
    nativeCurrency: chain.currency,
    rpcUrls: { default: { http: chain.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: chain.explorerUrl } },
  });
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: { theme: "dark", accentColor: "#9FB0F5", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: arc,
        supportedChains: [arc],
      }}
    >
      <ConnectWalletProvider>{children}</ConnectWalletProvider>
    </PrivyProvider>
  );
}
