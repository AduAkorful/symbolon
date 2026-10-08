"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SealBackdrop } from "@/components/signin/SealBackdrop";

/** How long the halves take to close before the page goes on (matches `.seal-half` in globals.css) */
const CLOSE_MS = 480;

/**
 * The sign-in screens' stage (plan 05zh): the Seal's cut behind the content. Choosing something marked `data-pick` (a link or a
 * form's button) closes the halves and then goes on with what the person chose. It is an addition to ordinary links and forms,
 * which work unchanged without it: modified clicks, reduced motion and a second click are never held up.
 */
export function SealStage({ children }: { children: ReactNode }) {
  const [sealing, setSealing] = useState(false);

  // coming back (the browser's back button restores this page as it was) must not leave the halves closed
  useEffect(() => {
    const reset = () => setSealing(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <div
      data-sealing={sealing ? "" : undefined}
      className="relative isolate flex min-h-screen flex-col overflow-hidden"
      onClickCapture={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-pick]");
        if (!target || target.dataset.passed || event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        event.preventDefault();
        event.stopPropagation();
        if (sealing) return;
        setSealing(true);
        window.setTimeout(() => {
          target.dataset.passed = "1";
          target.click();
        }, CLOSE_MS);
      }}
    >
      <SealBackdrop />
      {children}
    </div>
  );
}
