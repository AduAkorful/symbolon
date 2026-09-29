"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * A Vault release the owner can take (B23). The owner schedules it, waits the Vault's loosening delay, then applies it;
 * nothing changes until the apply. Prototype: a single example release, "Release 3", with a live countdown.
 */
export type ReleaseState = "available" | "scheduled" | "ready" | "applied";

/** The Vault's loosening delay (Acme's policy: 24 hours) */
export const RELEASE_DELAY_MS = 24 * 3600 * 1000;

export interface ReleaseCtx {
  state: ReleaseState;
  /** "23 h 59 m 41 s" while scheduled; null otherwise */
  remaining: string | null;
  /** 0 → 1 across the delay */
  fraction: number;
  schedule: () => void;
  cancel: () => void;
  apply: () => void;
  /** Prototype only: jump to the end of the delay so the apply step can be reviewed */
  skipWait: () => void;
}

const Ctx = createContext<ReleaseCtx>({
  state: "available",
  remaining: null,
  fraction: 0,
  schedule: () => {},
  cancel: () => {},
  apply: () => {},
  skipWait: () => {},
});

export function ReleaseProvider({ children }: { children: ReactNode }) {
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [applied, setApplied] = useState(false);
  // Starts after mount so the server and the browser render the same first frame
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (readyAt === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [readyAt]);

  const schedule = useCallback(() => {
    setNow(Date.now());
    setReadyAt(Date.now() + RELEASE_DELAY_MS);
  }, []);
  const cancel = useCallback(() => setReadyAt(null), []);
  const apply = useCallback(() => {
    setReadyAt(null);
    setApplied(true);
  }, []);
  const skipWait = useCallback(() => {
    setNow(Date.now());
    setReadyAt(Date.now());
  }, []);

  const value = useMemo<ReleaseCtx>(() => {
    const left = readyAt === null ? 0 : Math.max(0, Math.floor((readyAt - (now ?? Date.now())) / 1000));
    const state: ReleaseState = applied ? "applied" : readyAt === null ? "available" : left === 0 ? "ready" : "scheduled";
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    const remaining = state === "scheduled" ? `${h} h ${String(m).padStart(2, "0")} m ${String(left % 60).padStart(2, "0")} s` : null;
    const fraction = state === "ready" ? 1 : state === "scheduled" ? 1 - left / (RELEASE_DELAY_MS / 1000) : 0;
    return { state, remaining, fraction, schedule, cancel, apply, skipWait };
  }, [readyAt, now, applied, schedule, cancel, apply, skipWait]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRelease = () => useContext(Ctx);
