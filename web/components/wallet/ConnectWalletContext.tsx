"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { createContext, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { ConnectOutcome } from "@/components/wallet/connect-flow";

/** How long the connect window may stay open before the action goes on without it */
const CONNECT_TIMEOUT_MS = 120_000;

/**
 * Opens Privy's connect-a-wallet window and says how it ended (plan 05zi). `null` outside Privy's provider (a bare page, a test):
 * there is nothing to open, and the signers explain instead.
 */
export const ConnectWalletContext = createContext<(() => Promise<ConnectOutcome>) | null>(null);

/** Mounted inside `PrivyProvider`, because `useConnectWallet` needs it */
export function ConnectWalletProvider({ children }: { children: ReactNode }) {
  const pending = useRef<((outcome: ConnectOutcome) => void) | null>(null);
  const { connectWallet } = useConnectWallet({
    onSuccess: () => pending.current?.("connected"),
    // Privy reports a closed window as "exited_auth_flow"
    onError: (error) => pending.current?.(String(error) === "exited_auth_flow" ? "closed" : "error"),
  });
  const connect = useRef(connectWallet);
  connect.current = connectWallet;

  const prompt = useCallback(
    () =>
      new Promise<ConnectOutcome>((resolve) => {
        const timer = setTimeout(() => finish("error"), CONNECT_TIMEOUT_MS);
        function finish(outcome: ConnectOutcome) {
          clearTimeout(timer);
          pending.current = null;
          resolve(outcome);
        }
        pending.current = finish;
        connect.current();
      }),
    [],
  );
  const value = useMemo(() => prompt, [prompt]);
  return <ConnectWalletContext.Provider value={value}>{children}</ConnectWalletContext.Provider>;
}
