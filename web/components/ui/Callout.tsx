import type { ReactNode } from "react";

import type { Tone } from "./StatusPill";

const TONES: Record<Tone, string> = {
  ok: "border-ok/40 bg-ok-wash",
  warn: "border-warn/40 bg-warn-wash",
  danger: "border-red/40 bg-red-wash",
  info: "border-seal/40 bg-seal-wash",
  neutral: "border-rule bg-paper-raised",
};
const TITLE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", danger: "text-red", info: "text-seal", neutral: "text-ink" };

/**
 * A notice that stands out from the page: a title, the words, and the actions that deal with it (plan 05zb S8/S11). One look
 * for every banner (a shortfall, a warning, a confirmation), so tone, spacing and text size don't depend on who wrote it.
 * Pass `onDismiss` for the ones the person can put away.
 */
export function Callout({
  tone = "neutral",
  title,
  children,
  actions,
  onDismiss,
  className = "",
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-doc border px-5 py-4 text-sm ${TONES[tone]} ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {title ? <p className={`font-medium ${TITLE[tone]}`}>{title}</p> : null}
          {children ? <div className={`${title ? "mt-1" : ""} text-ink`}>{children}</div> : null}
        </div>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="-my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center px-3 text-graphite hover:text-ink sm:min-h-9">
            Dismiss
          </button>
        ) : null}
      </div>
      {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}
