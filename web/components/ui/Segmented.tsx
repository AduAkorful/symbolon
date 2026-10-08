"use client";

import { useId } from "react";

/**
 * A choice of one among a few, drawn as joined buttons with the chosen one filled (plan 05zb S2/S3). It is a radio group for
 * keyboards and screen readers, so the choice is announced and the arrow keys move it; the filled option is never the only
 * sign of the choice (it is also `aria-checked`).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** The label is still the group's accessible name; this only hides it from sight */
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <p id={`${id}-label`} className={hideLabel ? "sr-only" : "mb-1.5 text-sm font-medium text-ink"}>{label}</p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex gap-2">
        {options.map((o, i) => {
          const checked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              tabIndex={checked || (!options.some((x) => x.value === value) && i === 0) ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = options[(i + step + options.length) % options.length]!;
                onChange(next.value);
                const group = (e.currentTarget.parentElement as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]');
                group[(i + step + options.length) % options.length]?.focus();
              }}
              className={`min-h-11 flex-1 rounded-doc border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 ${
                checked ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink/60"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
