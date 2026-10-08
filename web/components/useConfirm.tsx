"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

interface Ask {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * `const [ask, confirmDialog] = useConfirm();` then `if (!(await ask({ … }))) return;` and render `{confirmDialog}` once. It is
 * the app's own dialog with the browser `confirm()`'s calling shape, so a handler keeps reading top to bottom (plan 05zb S11).
 */
export function useConfirm(): [(ask: Ask) => Promise<boolean>, ReactNode] {
  const [open, setOpen] = useState<Ask | null>(null);
  const resolve = useRef<((yes: boolean) => void) | null>(null);

  const ask = useCallback((a: Ask) => new Promise<boolean>((done) => {
    resolve.current = done;
    setOpen(a);
  }), []);

  const answer = (yes: boolean) => {
    resolve.current?.(yes);
    resolve.current = null;
    setOpen(null);
  };

  const dialog = open ? (
    <ConfirmDialog title={open.title} confirmLabel={open.confirmLabel} destructive={open.destructive} onConfirm={() => answer(true)} onClose={() => answer(false)}>
      {open.body}
    </ConfirmDialog>
  ) : null;
  return [ask, dialog];
}
