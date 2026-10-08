import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { box: string; dot: string }> = {
  ok: { box: "border-ok/40 bg-ok-wash text-ok", dot: "bg-ok" },
  warn: { box: "border-warn/40 bg-warn-wash text-warn", dot: "bg-warn" },
  danger: { box: "border-red/40 bg-red-wash text-red", dot: "bg-red" },
  info: { box: "border-seal/40 bg-seal-wash text-seal", dot: "bg-seal" },
  neutral: { box: "border-rule text-graphite", dot: "bg-graphite" },
};

/** The text colour that goes with a tone, for a status written without a pill */
export const toneText: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", danger: "text-red", info: "text-seal", neutral: "text-graphite" };

/**
 * A status as a word in a small pill: always the word, with the colour as extra, never colour alone (plan 05zb S8). One
 * shape for every status in the app, so "Paid" and "Cancelled" and "Held" look like the same kind of thing everywhere.
 */
export function StatusPill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${t.box} ${className}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}
