"use client";

import { useEffect, useState } from "react";

/** The event the Steward page sends when the owner changes mode, so the header says the new mode at once (QA R25-10) */
export const STEWARD_MODE_EVENT = "symbolon:steward-mode";

const MODE_NAMES: Record<string, string> = { shadow: "Shadow", assist: "Assisted", auto: "Autonomous" };

/** Tells the header the mode changed; the server render after `router.refresh()` then agrees with it */
export function announceStewardMode(mode: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STEWARD_MODE_EVENT, { detail: mode }));
}

/**
 * The header's mode word. It starts from the server's answer and follows a mode change made on this page, so a switch from
 * Assisted to Autonomous never leaves "Steward: Assisted" up until a reload.
 */
export function StewardModeName({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail;
      if (MODE_NAMES[mode]) setName(MODE_NAMES[mode]!);
    };
    window.addEventListener(STEWARD_MODE_EVENT, on);
    return () => window.removeEventListener(STEWARD_MODE_EVENT, on);
  }, []);
  return <>{name}</>;
}
