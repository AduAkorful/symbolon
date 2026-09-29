"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { tx } from "@/lib/tx";

interface PauseState {
  paused: boolean;
  setPaused: (p: boolean) => void;
  /** The owner's most recent pause or resume transaction, for the screens to link to */
  lastTx: { kind: "pause" | "resume"; hash: string } | null;
  clearTx: () => void;
}

const Ctx = createContext<PauseState>({ paused: false, setPaused: () => {}, lastTx: null, clearTx: () => {} });

/** The owner's one action that pauses the Steward and freezes outgoing payments (spec §9 Emergency). Onchain, so it has a transaction. */
export function PauseProvider({ children }: { children: ReactNode }) {
  const [paused, setPausedState] = useState(false);
  const [lastTx, setLastTx] = useState<PauseState["lastTx"]>(null);
  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
    setLastTx(p ? { kind: "pause", hash: tx.pause } : { kind: "resume", hash: tx.resume });
  }, []);
  const clearTx = useCallback(() => setLastTx(null), []);
  return <Ctx.Provider value={{ paused, setPaused, lastTx, clearTx }}>{children}</Ctx.Provider>;
}

export const usePause = () => useContext(Ctx);
