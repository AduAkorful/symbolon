"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { SectionTitle } from "@/components/ui/Type";

export interface OverlayProps {
  /** The dialog's heading. Overlay draws it, so every dialog has one in the same place and the dialog is named by it. */
  title: string;
  /** One sentence under the title saying what this is for */
  description?: ReactNode;
  onClose: () => void;
  /** False for a progress dialog the person can't dismiss while something is in flight: no close button, Escape or scrim click does nothing */
  dismissible?: boolean;
  /** `md` is the standard dialog (512 px); `lg` for the few that hold a table or two columns */
  size?: "md" | "lg";
  children: ReactNode;
}

/**
 * The footer of a dialog: the buttons, cancel first and the main action last (on a phone the main action comes first, full
 * width, because it is nearest the thumb). Put it as the last child of the dialog's content; inside a `<form>` its submit
 * button submits that form. It sticks at `-bottom-6`, not `bottom-0`: the dialog's body pads 24 px below its content and a sticky
 * edge is measured from the padded content box, so `bottom-0` pushed the footer up into the text above it.
 */
function OverlayFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky -bottom-6 -mx-6 -mb-6 mt-6 flex flex-col-reverse gap-3 border-t border-rule bg-paper-raised px-6 py-4 sm:flex-row sm:justify-end [&>*]:sm:min-w-28 max-sm:[&>*]:w-full">
      {children}
    </div>
  );
}

/**
 * The one accessible portal/dialog in the app, and the one frame (plan 05zb S1). Renders at the body level so a transformed
 * parent doesn't clip a `fixed` descendant. Owns the frame, the padding, the title with its close button, the description and
 * the scroll; callers pass only their content and an `Overlay.Footer`. Never draw your own box, border or padding inside it.
 * Provides: role=dialog, aria-modal, focus trap (Tab/Shift+Tab loop), focus return on close, Escape to close, scrim click to
 * close, rest-of-page inert, scroll lock. On a phone it is a sheet from the bottom edge.
 *
 * Every sheet and dialog in the app uses this. Never write another fixed overlay.
 */
export function Overlay({ title, description, onClose, dismissible = true, size = "md", children }: OverlayProps) {
  const titleId = useId();
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
    // the first control in the content, not the close button; the close button when there is nothing else
    const firstFocusable =
      panel.querySelector<HTMLElement>('[data-overlay-body] :is(input, select, textarea, button, [href]):not([disabled])') ??
      panel.querySelector<HTMLElement>("button") ??
      panel;
    firstFocusable.focus();
    return () => {
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Escape closes the dialog.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (dismissible) onClose();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose, dismissible]);

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
    const main = document.getElementById("main-content") || document.getElementById("app-main");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (main) main.inert = true;
    return () => {
      document.body.style.overflow = prevOverflow;
      if (main) main.inert = false;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-scrim backdrop-blur-sm md:items-center md:p-6"
      onClick={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-rule bg-paper-raised shadow-2xl outline-none md:max-h-[88dvh] md:rounded-2xl ${size === "lg" ? "max-w-2xl" : "max-w-lg"}`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <SectionTitle id={titleId}>{title}</SectionTitle>
            {description ? <p className="mt-1.5 text-sm text-graphite">{description}</p> : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-doc text-graphite transition-colors hover:text-ink"
            >
              <span aria-hidden className="text-2xl leading-none">×</span>
            </button>
          ) : null}
        </div>
        <div data-overlay-body className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 pb-6 text-sm">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

Overlay.Footer = OverlayFooter;
