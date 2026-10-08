"use client";

import type { ReactNode } from "react";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";

/**
 * A yes/no question in the app's own dialog, in place of the browser's `confirm()` (plan 05zb S11). Say what will happen in
 * `children`, name the button for the action ("Remove Ama", not "OK"), and set `destructive` when it can't be undone.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay title={title} onClose={() => { if (!busy) onClose(); }}>
      <div className="text-graphite">{children}</div>
      <Overlay.Footer>
        <Button variant="secondary" disabled={busy} onClick={onClose}>{cancelLabel}</Button>
        <Button variant={destructive ? "destructive" : "primary"} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </Overlay.Footer>
    </Overlay>
  );
}
