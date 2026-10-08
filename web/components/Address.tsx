import { CopyButton } from "@/components/CopyButton";
import { checksum, shortAddress } from "@/lib/format";

// Below this width of its own container, a `full` address is drawn shortened instead of broken across lines. A checksummed
// address in 14 px mono is about 360 px, and the arrow and Copy beside it need another 70.
const FULL_FITS = "@[28rem]";

/**
 * An address as people should see it: checksummed, never lowercase and never split across lines (plan 05zb S6). In a list
 * it is always the short form. With `full` it is the whole address when its container is wide enough and the short form
 * when it is not (a container query, so it adapts to the cell it is in, not to the window), and the explorer arrow and Copy
 * stay on the same row. The whole address is always in the tooltip and the accessible name. `full` makes it a block, so it
 * sits on a line of its own: put the label before it, not in the same sentence.
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
  const short = shortAddress(value);
  const text = full ? (
    <span title={whole} className={`min-w-0 font-mono ${className}`}>
      <span className={`${FULL_FITS}:hidden`}>{short}</span>
      <span className={`hidden ${FULL_FITS}:inline`}>{whole}</span>
    </span>
  ) : (
    <span title={whole} className={`font-mono ${className}`}>
      {short}
    </span>
  );
  const body = explorer ? (
    <a href={`${explorer}/address/${whole}`} target="_blank" rel="noreferrer" aria-label={`View ${whole} on the Arc explorer`} className="min-w-0 underline decoration-rule underline-offset-4 hover:decoration-ink">
      {text}
      <span aria-hidden> ↗</span>
    </a>
  ) : (
    text
  );
  const copyButton = copy ? <CopyButton value={whole} label={`Copy ${whole}`} /> : null;
  if (full) {
    return (
      <span className="@container block w-full min-w-0 max-w-full">
        <span className="flex min-w-0 flex-nowrap items-baseline">
          {body}
          {copyButton}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline">
      {body}
      {copyButton}
    </span>
  );
}
