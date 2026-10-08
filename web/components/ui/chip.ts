/**
 * The filter chip: a rounded pill that is filled when it is the current choice (plan 05zb S2). Used for the inbox filters,
 * the activity filters and anything else that narrows a list. Apply to a `<button aria-pressed>` or a `<Link aria-current>`.
 */
export const chipClass = (selected: boolean, className = "") =>
  `inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors sm:min-h-9 ${
    selected ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink/60"
  } ${className}`.trim();
