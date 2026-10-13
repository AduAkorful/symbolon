import { formatAmount, parseAmount } from "@symbolon/seal";

/** Form values stay decimal strings; only exact parsing may produce wallet amounts. */
export function moneyDraft(value: string, decimals: number): { raw: bigint; error?: undefined } | { raw?: undefined; error: string } {
  try {
    const raw = parseAmount(value, decimals);
    if (raw < 0n || raw > (1n << 256n) - 1n) throw new Error("Amount is outside the token's valid range.");
    return { raw };
  } catch {
    return { error: `Enter a non-negative amount with at most ${decimals} decimal places.` };
  }
}

export function moneyInput(raw: string | bigint, decimals: number): string {
  return formatAmount(BigInt(raw), decimals);
}

/**
 * An amount for a text field: every real digit kept, at least two decimals, no thousands separators (the field is parsed back
 * exactly). "25000.000000" → "25000.00"; "15.375000" → "15.375".
 */
export function inputAmount(raw: string | bigint, decimals: number): string {
  const text = moneyInput(raw, decimals);
  const [whole = "0", fraction = ""] = text.split(".");
  return `${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}
