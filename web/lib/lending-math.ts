/**
 * What moving `amount` USDC into lending would leave, against the bills due and the operating floor (plan 05zu 3.4).
 * All raw 6-decimal units. Null when the move keeps bills covered, or when the amount isn't a number we can read.
 */
export function lendingShortfall(input: { cash: string; billsDue: string | null; minOperating: string; amount: string }): { left: bigint; most: bigint | null } | null {
  if (input.billsDue === null || !/^\d+(\.\d{1,6})?$/.test(input.amount.trim())) return null;
  const [whole, frac = ""] = input.amount.trim().split(".");
  const units = BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  const needed = BigInt(input.billsDue) + BigInt(input.minOperating);
  const cash = BigInt(input.cash);
  const left = cash - units;
  if (left >= needed) return null;
  const room = cash - needed;
  return { left: left < 0n ? 0n : left, most: room > 0n ? room : null };
}
