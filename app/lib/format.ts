import { formatAmount, parseAmount } from "@symbolon/seal";

// Display helpers for canonical decimal strings. Amounts are never turned into floating point: they stay exact digits.

/** "2880.000000" → "2,880.00"; keeps more decimals only where they are not zero ("15.375000" → "15.375") */
export function showAmount(value: string): string {
  const [whole = "0", frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${trimmed}`;
}

/** A unix time in seconds as an unambiguous UTC date, "2026-09-29" */
export function showDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** 150 → "1.5", 75 → "0.75", 2000 → "20" */
export function showBps(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/**
 * The amount the ledger would credit at a discount: `credit - credit * bps / 10000`, integer arithmetic exactly as
 * `InvoiceLedger._applyDiscount` does it.
 */
export function discounted(total: string, decimals: number, bps: number): string {
  const raw = parseAmount(total, decimals);
  return formatAmount(raw - (raw * BigInt(bps)) / 10_000n, decimals);
}
