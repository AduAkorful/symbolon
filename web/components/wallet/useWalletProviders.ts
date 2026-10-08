"use client";

import { useWallets } from "@privy-io/react-auth";
import { useCallback, useContext, useRef } from "react";
import type { Eip1193 } from "@/components/signin/wallet";
import { ConnectWalletContext } from "@/components/wallet/ConnectWalletContext";
import { ensureWallets } from "@/components/wallet/connect-flow";

/**
 * The signers' way to reach the person's wallets (plan 05k, P5): Privy's wallets for the signed-in person, each as an EIP-1193
 * provider. Which one holds `users.wallet` is decided by the signer (`findWalletFor`), not here. Waits a moment for Privy to be ready.
 * When Privy lists no wallet at all (our session can outlive the browser's wallet connection), it opens Privy's connect window
 * and carries on with the wallet that connects (plan 05zi); the signer still insists on the account's own wallet.
 */
export function useWalletProviders(): () => Promise<Eip1193[]> {
  const { wallets, ready } = useWallets();
  const latest = useRef({ wallets, ready });
  latest.current = { wallets, ready };
  const prompt = useContext(ConnectWalletContext);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;

  return useCallback(async () => {
    for (let i = 0; i < 50 && !latest.current.ready; i++) await new Promise((r) => setTimeout(r, 100));
    if (!latest.current.ready) throw new Error("Your wallet isn't ready yet. Wait a moment and try again.");
    const ask = promptRef.current;
    if (ask) await ensureWallets({ count: () => latest.current.wallets.length, prompt: ask });
    return Promise.all(latest.current.wallets.map((w) => w.getEthereumProvider() as Promise<Eip1193>));
  }, []);
}
