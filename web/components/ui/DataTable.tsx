import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-align the column and, on a phone, show its value on the card's first line (use it for the amount) */
  amount?: boolean;
  /** The row's name: shown as the card's title on a phone */
  primary?: boolean;
  /** Keep the cell on one line (dates, hashes, amounts) */
  nowrap?: boolean;
}

/**
 * A table that stays readable on a phone (plan 05zb S10). From `md` up it is a real table with header cells scoped to their
 * columns; below that each row becomes a card: the `primary` column as its title, the `amount` column beside it, and the
 * rest as label and value pairs. Nothing scrolls sideways, and text that can't be split (an amount, a date, a hash) never wraps.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  className = "",
}: {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T, index: number) => string;
  /** Names the table for screen readers */
  caption: string;
  className?: string;
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0]!;
  const amount = columns.find((c) => c.amount);
  const rest = columns.filter((c) => c !== primary && c !== amount);
  return (
    <div className={className}>
      <table className="hidden w-full border-t border-ink text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-graphite">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`py-3 pr-4 font-normal ${c.amount ? "text-right" : ""}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-t border-rule-soft align-top">
              {columns.map((c) => (
                <td key={c.key} className={`py-3 pr-4 ${c.amount ? "text-right font-medium" : ""} ${c.nowrap || c.amount ? "whitespace-nowrap" : "break-words"} ${c.primary ? "font-medium text-ink" : ""}`}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-rule-soft border-y border-rule md:hidden" aria-label={caption}>
        {rows.map((row, i) => (
          <li key={rowKey(row, i)} className="py-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 break-words font-medium text-ink">{primary.cell(row)}</span>
              {amount ? <span className="shrink-0 whitespace-nowrap font-medium text-ink">{amount.cell(row)}</span> : null}
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              {rest.map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-graphite">{c.header}</dt>
                  <dd className={`min-w-0 text-right ${c.nowrap ? "whitespace-nowrap" : "break-words"}`}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
