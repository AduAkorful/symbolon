"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export interface OverlayProps {
  /** Required: the heading element's id (for aria-labelledby) or a short label string (for aria-label). */
  label: string | { id: string };
  onClose: () => void;
  children: ReactNode;
}

/**
 * The one accessible portal/dialog in the app. Renders at the body level so a transformed parent doesn't clip a
 * `fixed` descendant. Provides: role=dialog, aria-modal, focus trap (Tab/Shift+Tab loop), focus return on close,
 * Escape to close, scrim click to close, rest-of-page inert, scroll lock.
 *
 * Every sheet and dialog in the app uses this. Never write another fixed overlay.
 */
export function Overlay({ label, onClose, children }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Capture the element that had focus when this opened so we can return to it.
  useEffect(() => {
    openerRef.current = document.activeElement;
  }, []);

  // Move focus into the dialog on mount; return it to the opener on unmount.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const firstFocusable = panel.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
    return () => {
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Escape closes the dialog.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  // Tab trap: keep focus inside the dialog.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    panel.addEventListener("keydown", handle);
    return () => panel.removeEventListener("keydown", handle);
  }, []);

  // Make the rest of the page inert and lock scroll.
  useEffect(() => {
    const main = document.getElementById("app-main");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    return () => {
      document.body.style.overflow = prevOverflow;
      if (main) main.inert = false;
    };
  }, []);

  if (typeof document === "undefined") return null;

  const ariaProps =
    typeof label === "string"
      ? { "aria-label": label }
      : { "aria-labelledby": label.id };

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim md:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        {...ariaProps}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-rule bg-paper-raised shadow-2xl md:rounded-2xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
