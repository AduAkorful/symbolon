"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useContext, useRef } from "react";
import type { Eip1193 } from "@/components/signin/wallet";
import { ConnectWalletContext } from "@/components/wallet/ConnectWalletContext";
import { ensureSignerSession, WALLET_NOT_READY } from "@/components/wallet/connect-flow";

/**
 * The signers' way to reach the person's wallets (plan 05k, P5): Privy's wallets for the signed-in person, each as an EIP-1193
 * provider. Which one holds `users.wallet` is decided by the signer (`findWalletFor`), not here.
 *
 * Our cookie can outlive Privy's session. Before handing wallets over: wait for the SDK, refresh an expired Privy token,
 * open login if that session is gone (email/embedded wallets only come back that way), wait for the wallet list to settle,
 * and if it is still empty open the connect window (plan 05zi). The signer still insists on the account's own wallet.
 */
export function useWalletProviders(): () => Promise<Eip1193[]> {
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const latest = useRef({ wallets, privyReady, authenticated, walletsReady });
  latest.current = { wallets, privyReady, authenticated, walletsReady };
  const session = useContext(ConnectWalletContext);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  return useCallback(async () => {
    const ask = sessionRef.current;
    if (ask) {
      await ensureSignerSession({
        privyReady: () => latest.current.privyReady,
        authenticated: () => latest.current.authenticated,
        walletsReady: () => latest.current.walletsReady,
        walletCount: () => latest.current.wallets.length,
        refresh: ask.refresh,
        login: ask.login,
        connect: ask.connect,
      });
    } else {
      for (let i = 0; i < 100 && !latest.current.walletsReady; i++) await new Promise((r) => setTimeout(r, 100));
      if (!latest.current.walletsReady) throw new Error(WALLET_NOT_READY);
    }
    return Promise.all(latest.current.wallets.map((w) => w.getEthereumProvider() as Promise<Eip1193>));
  }, []);
}
