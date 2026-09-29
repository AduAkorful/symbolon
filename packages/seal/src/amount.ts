import { QUANTITY_MAX_DECIMALS } from "./constants.js";
import { SealError } from "./errors.js";

const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_TOKEN_DECIMALS = 18;

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new SealError(`unsupported token decimals ${decimals}`);
  }
}

/**
 * Parses a human amount ("1250.5") into raw token units. Never rounds: more fraction digits than the token has is an
 * error, as is anything that isn't a plain non-negative decimal (no sign, exponent, separators or whitespace).
 */
export function parseAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  const match = DECIMAL_RE.exec(value);
  if (!match) throw new SealError(`"${value}" is not a plain decimal amount`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new SealError(`"${value}" has more precision than the token's ${decimals} decimals`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Formats raw token units canonically: exactly `decimals` fraction digits ("1250.000000") */
export function formatAmount(raw: bigint, decimals: number): string {
  assertDecimals(decimals);
  if (raw < 0n) throw new SealError("amounts are never negative");
  const digits = raw.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** True when `value` is already in the canonical form `formatAmount` produces */
export function isCanonicalAmount(value: string, decimals: number): boolean {
  try {
    return formatAmount(parseAmount(value, decimals), decimals) === value;
  } catch {
    return false;
  }
}

/** A positive quantity as an integer scaled by 10^scale */
export interface Quantity {
  units: bigint;
  scale: number;
}

/** Parses a positive line-item quantity with at most `QUANTITY_MAX_DECIMALS` fraction digits */
export function parseQuantity(value: string): Quantity {
  const match = DECIMAL_RE.exec(value);
  if (!match) throw new SealError(`"${value}" is not a plain decimal quantity`);
  const fraction = match[2] ?? "";
  if (fraction.length > QUANTITY_MAX_DECIMALS) {
    throw new SealError(`quantity "${value}" has more than ${QUANTITY_MAX_DECIMALS} fraction digits`);
  }
  const units = BigInt((match[1] ?? "0") + fraction);
  if (units === 0n) throw new SealError("quantity must be greater than zero");
  return { units, scale: fraction.length };
}

/** Canonical quantity: no trailing fraction zeros, no trailing point ("7.5", "10") */
export function formatQuantity(q: Quantity): string {
  let units = q.units;
  let scale = q.scale;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  const digits = units.toString().padStart(scale + 1, "0");
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function isCanonicalQuantity(value: string): boolean {
  try {
    return formatQuantity(parseQuantity(value)) === value;
  } catch {
    return false;
  }
}

/** `numerator / denominator` rounded half up; both non-negative */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** A line's amount in raw token units: quantity × unit price, rounded half up at token precision */
export function lineAmount(quantity: string, unitPriceRaw: bigint): bigint {
  const q = parseQuantity(quantity);
  return divRoundHalfUp(q.units * unitPriceRaw, 10n ** BigInt(q.scale));
}
