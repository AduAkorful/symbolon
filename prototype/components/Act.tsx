"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TxLink } from "@/components/TxLink";
import { Overlay } from "@/components/Overlay";

interface Confirm {
  title: string;
  body?: ReactNode;
  /** The button that goes through with it, e.g. "Sign and queue" */
  action: string;
  /** An input the person fills in first (a reason, an email, an amount) */
  field?: { label: string; placeholder?: string; inputMode?: "text" | "decimal" | "email" };
}

interface Props {
  children: ReactNode;
  /** The button's classes: the caller's existing look stays as it was */
  className?: string;
  /** What the screen says once it's done. A function gets the value of `confirm.field`. */
  done: ReactNode | ((value: string) => ReactNode);
  /** The transaction it made, if it's onchain */
  tx?: string;
  /** Ask first: irreversible or onchain actions open a sheet before they happen */
  confirm?: Confirm;
  /** Puts this text on the clipboard (a leading "/" becomes this site's address) */
  copy?: string;
  /** Opens this page in a new tab */
  open?: string;
  /** Saves this text as a file */
  download?: { filename: string; text: string; mime?: string };
  /** Runs once the action has gone through (client screens only) */
  onDone?: (value: string) => void;
}

/**
 * A prototype button that does something: optionally asks first, does its small real effect (copy, open, download), then
 * shows what happened in place of itself. Nothing here is decorative; every button in the prototype goes somewhere.
 */
export function Act({ children, className = "", done, tx, confirm, copy, open, download, onDone }: Props) {
  const [state, setState] = useState<"idle" | "confirming" | "done">("idle");
  const [value, setValue] = useState("");
  const first = useRef<HTMLInputElement | HTMLButtonElement | null>(null);

  useEffect(() => {
    if (state !== "confirming") return;
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setState("idle");
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [state]);

  const finish = () => {
    if (copy) {
      const text = copy.startsWith("/") ? window.location.origin + copy : copy;
      void navigator.clipboard?.writeText(text).catch(() => {});
    }
    if (open) window.open(open, "_blank", "noopener");
    if (download) {
      const url = URL.createObjectURL(new Blob([download.text], { type: download.mime ?? "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = download.filename;
      a.click();
      URL.revokeObjectURL(url);
    }
    setState("done");
    onDone?.(value);
  };

  if (state === "done")
    return (
      <span role="status" className="inline-flex flex-wrap items-baseline gap-x-2 text-sm">
        <span>{typeof done === "function" ? done(value) : done}</span>
        {tx ? <TxLink hash={tx}>{tx}</TxLink> : null}
      </span>
    );

  return (
    <>
      <button type="button" className={className} onClick={() => (confirm ? setState("confirming") : finish())}>
        {children}
      </button>
      {state === "confirming" && confirm ? (
        <Overlay aria-label={confirm.title}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              finish();
            }}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-rule bg-paper-raised p-7 text-left text-ink shadow-2xl md:rounded-2xl"
          >
            <h2 className="font-display text-3xl">{confirm.title}</h2>
            {confirm.body ? <div className="text-sm text-graphite">{confirm.body}</div> : null}
            {confirm.field ? (
              <label className="block text-sm">
                {confirm.field.label}
                <input
                  ref={(el) => {
                    first.current = el;
                  }}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={confirm.field.placeholder}
                  inputMode={confirm.field.inputMode}
                  className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
                />
              </label>
            ) : null}
            <div className="flex gap-3">
              <button
                ref={(el) => {
                  if (!confirm.field) first.current = el;
                }}
                className="flex-1 rounded-doc bg-ink py-2.5 font-medium text-paper"
              >
                {confirm.action}
              </button>
              <button type="button" onClick={() => setState("idle")} className="rounded-doc border border-rule px-4 py-2.5">
                Cancel
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}
    </>
  );
}
