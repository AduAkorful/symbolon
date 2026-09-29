"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A full-screen layer for sheets and dialogs. It renders at the top of the page, not inside the screen that opened it:
 * the screens' arrive animation leaves a transform on their sections, and a transformed parent becomes the box a
 * "fixed" child is sized to, so the dimming would only cover that section.
 */
export function Overlay({ children, ...aria }: { children: ReactNode; "aria-label"?: string; "aria-labelledby"?: string }) {
  // Sheets open from a click, never on first load, so there is always a document by the time this renders
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-scrim md:items-center" role="dialog" aria-modal="true" {...aria}>
      {children}
    </div>,
    document.body,
  );
}
