"use client";

import { useConnectWallet, useLogin, usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ConnectOutcome } from "@/components/wallet/connect-flow";

/** How long a Privy window may stay open before the action goes on without it */
const WINDOW_TIMEOUT_MS = 120_000;

export interface WalletSession {
  /** Opens Privy's connect-a-wallet window (an external wallet the browser forgot) */
  connect: () => Promise<ConnectOutcome>;
  /** Opens Privy's login window (restores an email/embedded wallet after our cookie outlived Privy's session) */
  login: () => Promise<ConnectOutcome>;
  /** Refreshes an expired Privy access token; null if there is no session to restore */
  refresh: () => Promise<string | null>;
}

/**
 * Opens Privy's windows and refreshes its session (plan 05zi). `null` outside Privy's provider (a bare page, a test):
 * there is nothing to open, and the signers explain instead.
 */
export const ConnectWalletContext = createContext<WalletSession | null>(null);

function openWindow(start: () => void, pending: { current: ((outcome: ConnectOutcome) => void) | null }): Promise<ConnectOutcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish("error"), WINDOW_TIMEOUT_MS);
    function finish(outcome: ConnectOutcome) {
      clearTimeout(timer);
      pending.current = null;
      resolve(outcome);
    }
    pending.current = finish;
    try {
      start();
    } catch {
      finish("error");
    }
  });
}

function ended(error: unknown): ConnectOutcome {
  return String(error) === "exited_auth_flow" ? "closed" : "error";
}

/** Mounted inside `PrivyProvider`, because the Privy hooks need it */
export function ConnectWalletProvider({ children }: { children: ReactNode }) {
  const { ready, getAccessToken } = usePrivy();
  const refreshRef = useRef(getAccessToken);
  refreshRef.current = getAccessToken;

  // Privy docs: call getAccessToken on load so an expired access token is rotated before a signing click.
  useEffect(() => {
    if (!ready) return;
    void refreshRef.current().catch(() => undefined);
  }, [ready]);

  const pendingConnect = useRef<((outcome: ConnectOutcome) => void) | null>(null);
  const pendingLogin = useRef<((outcome: ConnectOutcome) => void) | null>(null);

  const { connectWallet } = useConnectWallet({
    onSuccess: () => pendingConnect.current?.("connected"),
    onError: (error) => pendingConnect.current?.(ended(error)),
  });
  const { login } = useLogin({
    onComplete: () => pendingLogin.current?.("connected"),
    onError: (error) => pendingLogin.current?.(ended(error)),
  });

  const connectFn = useRef(connectWallet);
  connectFn.current = connectWallet;
  const loginFn = useRef(login);
  loginFn.current = login;

  const connect = useCallback(() => openWindow(() => connectFn.current(), pendingConnect), []);
  const loginPrompt = useCallback(() => openWindow(() => loginFn.current(), pendingLogin), []);
  const refresh = useCallback(() => refreshRef.current(), []);
  const value = useMemo<WalletSession>(
    () => ({ connect, login: loginPrompt, refresh }),
    [connect, loginPrompt, refresh],
  );
  return <ConnectWalletContext.Provider value={value}>{children}</ConnectWalletContext.Provider>;
}
