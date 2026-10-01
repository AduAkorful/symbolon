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
