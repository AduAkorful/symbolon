/** The logo lockup, loaded from the SVG file in public/brand. The app is dark only, so the file's colours (pale and periwinkle) are fixed. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/symbolon-logo.svg" alt="Symbolon" className="h-[1.55rem] w-auto" />
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


