import { CopyButton } from "@/components/CopyButton";
import { checksum, shortAddress } from "@/lib/format";

/**
 * An address as people should see it: checksummed, whole in detail rows (`full`) and middle-shortened in lists, never
 * lowercase and never overflowing its column. With `explorer` it links to the Arc explorer; with `copy` it can be copied.
 * The full address is always in the tooltip and the accessible name.
 */
export function Address({
  value,
  full = false,
  explorer,
  copy = false,
  className = "",
}: {
  value: string;
  full?: boolean;
  explorer?: string;
  copy?: boolean;
  className?: string;
}) {
  const whole = checksum(value);
  const shown = full ? whole : shortAddress(value);
  const text = (
    <span title={whole} className={`font-mono ${full ? "break-all" : ""} ${className}`}>
      {shown}
    </span>
  );
  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-baseline">
      {explorer ? (
        <a href={`${explorer}/address/${whole}`} target="_blank" rel="noreferrer" aria-label={`View ${whole} on the Arc explorer`} className="min-w-0 underline decoration-rule underline-offset-4 hover:decoration-ink">
          {text}
          <span aria-hidden> ↗</span>
        </a>
      ) : (
        text
      )}
      {copy ? <CopyButton value={whole} label={`Copy ${whole}`} /> : null}
    </span>
  );
}
