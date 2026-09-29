import type { CSSProperties, ReactNode } from "react";
import { payerClip, seamFor, vendorClip, type Seam } from "@/lib/chirograph";

type Side = "vendor" | "payer";

/** The ink line along the cut, drawn over the seam strip (2 × amplitude wide) */
function SeamLine({ seam, side, tone }: { seam: Seam; side: Side; tone: string }) {
  const n = seam.offsets.length - 1;
  const d = seam.offsets.map((o, i) => `${i === 0 ? "M" : "L"} ${seam.amplitude + o} ${(i / n) * 100}`).join(" ");
  const pos: CSSProperties = side === "vendor" ? { right: 0 } : { left: 0 };
  return (
    <svg
      aria-hidden
      data-seam="line"
      viewBox={`0 0 ${seam.amplitude * 2} 100`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute top-0 h-full"
      style={{ ...pos, width: seam.amplitude * 2 }}
    >
      <path d={d} fill="none" stroke={tone} strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeDasharray="1 3" />
    </svg>
  );
}

/** The fingerprint written across the cut, as on a chirograph; each half keeps part of every letter */
function SeamLetters({ text, seam, side, className = "" }: { text: string; seam: Seam; side: Side; className?: string }) {
  const center: CSSProperties =
    side === "vendor" ? { right: seam.amplitude, transform: "translateX(50%)" } : { left: seam.amplitude, transform: "translateX(-50%)" };
  return (
    <div
      aria-hidden
      data-seam="letters"
      className="pointer-events-none absolute top-0 bottom-0 flex items-center justify-center select-none"
      style={center}
    >
      <span
        className={`whitespace-nowrap font-mono text-[22px] leading-none tracking-[0.3em] text-ink/[0.2] ${className}`}
        style={{ writingMode: "vertical-rl" }}
      >
        {text}
      </span>
    </div>
  );
}

export function Half({
  side,
  fingerprint,
  amplitude = 11,
  className = "",
  seamClassName = "",
  tone = "var(--rule)",
  children,
}: {
  side: Side;
  fingerprint: string;
  amplitude?: number;
  className?: string;
  seamClassName?: string;
  tone?: string;
  children: ReactNode;
}) {
  const seam = seamFor(fingerprint, amplitude);
  const text = fingerprint.replace(/^0x/, "").slice(0, 18).toUpperCase();
  return (
    <div className={`relative ${className}`} style={{ clipPath: side === "vendor" ? vendorClip(seam) : payerClip(seam) }}>
      {children}
      <SeamLetters text={text} seam={seam} side={side} className={seamClassName} />
      <SeamLine seam={seam} side={side} tone={tone} />
    </div>
  );
}
