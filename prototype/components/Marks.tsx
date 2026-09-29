import { MARK, MARK_SMALL } from "@/lib/brand";

/**
 * The Symbolon mark: a document cut in two along the chirograph seam, the same wavy edge every invoice carries.
 * Ink and seal, the product's own colours (they flip with the theme). `small` widens the hairline for icon sizes.
 */
export function Mark({ className = "", small = false, mono = false }: { className?: string; small?: boolean; mono?: boolean }) {
  const m = small ? MARK_SMALL : MARK;
  return (
    <svg viewBox={`0 0 ${m.width} ${m.height}`} className={className} aria-hidden>
      <path d={m.left} fill="var(--ink)" />
      <path d={m.right} fill={mono ? "var(--ink)" : "var(--seal)"} />
    </svg>
  );
}

/** The horizontal lockup: the mark and the name in Libre Caslon Display. Proportions follow prototype/public/brand/symbolon-logo.svg. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.3em] text-[1.35rem] ${className}`}>
      <Mark small className="h-[1em] w-auto" />
      <span className="font-display leading-none tracking-[-0.012em]">Symbolon</span>
    </span>
  );
}

/** A Seal impression in signature ink: the vendor's handle around a ring */
export function SealStamp({ handle, size = 72, className = "" }: { handle: string; size?: number; className?: string }) {
  const id = `ring-${handle.replace(/\W/g, "")}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={`text-seal ${className}`} aria-label={`Sealed by ${handle}`}>
      <defs>
        <path id={id} d="M50 50 m -36 0 a 36 36 0 1 1 72 0 a 36 36 0 1 1 -72 0" />
      </defs>
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="50" cy="50" r="27" fill="none" stroke="currentColor" strokeWidth="1" />
      <text className="font-mono" fontSize="9.5" letterSpacing="2.2" fill="currentColor">
        <textPath href={`#${id}`}>{`SEALED · ${handle.toUpperCase()} · SEALED ·`}</textPath>
      </text>
      <path d="M50 30 C 45 38, 56 44, 49 50 S 53 62, 50 70" fill="none" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function DemoTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-graphite/50" />
      Demo data
    </span>
  );
}
