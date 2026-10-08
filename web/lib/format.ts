import { getAddress } from "viem";
import { formatAmount, parseAmount } from "@symbolon/seal";

// Display helpers for canonical decimal strings. Amounts are never turned into floating point: they stay exact digits.

/** "2880.000000" → "2,880.00"; keeps more decimals only where they are not zero ("15.375000" → "15.375") */
export function showAmount(value: string): string {
  const [whole = "0", frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${trimmed}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const UNAVAILABLE_DATE = "Date unavailable";

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A day as people write it, "4 Oct", with the year ("4 Oct 2026") when it isn't this year or when `year: "always"`. Always UTC
 * and never locale-dependent, so the server and the browser print the same text and nobody has to guess a time zone.
 */
export function formatDay(value: Date | string | null | undefined, opts: { year?: "always" | "auto"; now?: Date } = {}): string {
  const d = asDate(value);
  if (!d) return UNAVAILABLE_DATE;
  const withYear = opts.year === "always" || d.getUTCFullYear() !== (opts.now ?? new Date()).getUTCFullYear();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
}

/** A moment, "4 Oct, 14:05 UTC": the zone is always named */
export function formatDateTime(value: Date | string | null | undefined, opts: { now?: Date } = {}): string {
  const d = asDate(value);
  if (!d) return UNAVAILABLE_DATE;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDay(d, opts)}, ${hh}:${mm} UTC`;
}

/** A unix time in seconds as a day with its year, "21 Sep 2026": invoices and receipts always show the year */
export function showDate(seconds: number): string {
  return formatDay(new Date(seconds * 1000), { year: "always" });
}

/**
 * An amount with its currency the way the rest of the product writes money: "$14,000.00", "€2,400.00"; any other token keeps
 * its symbol after the number. The digits are `showAmount`'s, so precision is never rounded away.
 */
export function showMoney(amount: string, symbol: string): string {
  const digits = showAmount(amount);
  if (symbol === "USDC" || symbol === "USD") return `$${digits}`;
  if (symbol === "EURC" || symbol === "EUR") return `€${digits}`;
  return symbol ? `${digits} ${symbol}` : digits;
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

/** The Vault's "no limit" for a budget or cap: the largest uint256. It is a setting, never an amount to print. */
export const UNLIMITED_CAP = 2n ** 256n - 1n;

export function isUnlimitedCap(raw: bigint): boolean {
  return raw === UNLIMITED_CAP;
}

const HOUR = 3_600n;
const DAY = 24n * HOUR;

/** Whole dollars from raw 6-decimal units, with the cents the UI always shows */
export function usd(raw: bigint, decimals = 6): string {
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  const cents = ((raw % unit) * 100n) / unit;
  return `$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function duration(seconds: bigint): string {
  if (seconds % DAY === 0n) {
    const d = seconds / DAY;
    return d === 1n ? "1 day" : `${d} days`;
  }
  const h = seconds / HOUR;
  return h === 1n ? "1 hour" : `${h} hours`;
}


/** The EIP-55 checksummed form of an address. Anything that isn't an address comes back unchanged: it is never made to look like one. */
export function checksum(value: string): string {
  try {
    return getAddress(value);
  } catch {
    return value;
  }
}

/** "0x1a2B…c3D4": the middle left out, for lists and tables only. Detail rows show the whole address. */
export function shortAddress(value: string): string {
  const full = checksum(value);
  return /^0x[0-9a-fA-F]{40}$/.test(full) ? `${full.slice(0, 6)}…${full.slice(-4)}` : full;
}


/** Free text with any full address in it shortened ("paid 0x7d9a…", never 42 characters that can't be split): for names and labels, not for places an address is checked */
export function shortenAddressesIn(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{40}\b/g, (a) => shortAddress(a));
}
