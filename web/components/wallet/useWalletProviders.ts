"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback, useRef } from "react";
import type { Eip1193 } from "@/components/signin/wallet";

/**
 * The signers' way to reach the person's wallets (plan 05k, P5): Privy's wallets for the signed-in person, each as an EIP-1193
 * provider. Which one holds `users.wallet` is decided by the signer (`findWalletFor`), not here. Waits a moment for Privy to be ready.
 */
export function useWalletProviders(): () => Promise<Eip1193[]> {
  const { wallets, ready } = useWallets();
  const latest = useRef({ wallets, ready });
  latest.current = { wallets, ready };
  return useCallback(async () => {
    for (let i = 0; i < 50 && !latest.current.ready; i++) await new Promise((r) => setTimeout(r, 100));
    if (!latest.current.ready) throw new Error("Your wallet isn't ready yet. Wait a moment and try again.");
    return Promise.all(latest.current.wallets.map((w) => w.getEthereumProvider() as Promise<Eip1193>));
  }, []);
}
