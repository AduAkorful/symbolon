import type { ReactNode } from "react";

import { showMoney } from "@/lib/format";

/**
 * An amount of money (plan 05zb S7). Always the sans face with lining figures, never `tabular-nums`: this typeface draws a
 * wide period and comma in tabular mode ("$8 , 000 . 00"). Never wraps, so an amount can't break across lines. Pass `value`
 * and `symbol` to have it formatted, or the already formatted text as children.
 */
export function Money({ value, symbol, children, className = "" }: { value?: string; symbol?: string; children?: ReactNode; className?: string }) {
  return <span className={`whitespace-nowrap ${className}`}>{value !== undefined ? showMoney(value, symbol ?? "") : children}</span>;
}
