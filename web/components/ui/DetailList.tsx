import type { ReactNode } from "react";

/**
 * A list of facts, label on the left and value on the right, in one box. The standard way to show "what this is" in a dialog
 * or a card. On a narrow screen a long value wraps under its label instead of pushing the box wider.
 */
export function DetailList({ items, className = "" }: { items: readonly { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={`divide-y divide-rule-soft rounded-doc border border-rule px-4 ${className}`}>
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
          <dt className="shrink-0 text-graphite">{item.label}</dt>
          <dd className="min-w-0 break-words font-medium text-ink sm:text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
