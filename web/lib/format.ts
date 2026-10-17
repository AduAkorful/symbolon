import { getAddress } from "viem";
import { formatAmount, parseAmount } from "@symbolon/seal";

// Display helpers for canonical decimal strings. Amounts are never turned into floating point: they stay exact digits.

const group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Money on screen, at two decimals (QA FMT-1): "2880.000000" → "2,880.00", "90.999999" → "91.00", half up on the third decimal.
 * A non-zero amount under a cent keeps its exact digits ("0.000001"), so it never reads as nothing. The arithmetic stays on
 * digits, never floating point. Where the exact figure matters (a receipt, a transaction's detail) use `showExactAmount`.
 */
export function showAmount(value: string): string {
  const negative = value.startsWith("-");
  const [rawWhole = "0", frac = ""] = (negative ? value.slice(1) : value).split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  if (whole === "0" && /^00/.test(frac.padEnd(2, "0")) && /[1-9]/.test(frac)) return `${negative ? "-" : ""}${showExactAmount(`0.${frac}`)}`;
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0").slice(0, 2)) + (Number(frac[2] ?? "0") >= 5 ? 1n : 0n);
  const out = `${group((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, "0")}`;
  return negative && cents > 0n ? `-${out}` : out;
}

/** The exact digits, grouped: "2880.000000" → "2,880.00", "15.375000" → "15.375", "90.999999" → "90.999999" */
export function showExactAmount(value: string): string {
  const [whole = "0", frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${group(whole)}.${trimmed}`;
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
 * its symbol after the number. Two decimals on screen (`showAmount`); `{ exact: true }` keeps every digit.
 */
export function showMoney(amount: string, symbol: string, opts: { exact?: boolean } = {}): string {
  const digits = opts.exact ? showExactAmount(amount) : showAmount(amount);
  if (symbol === "USDC" || symbol === "USD") return `$${digits}`;
  if (symbol === "EURC" || symbol === "EUR") return `€${digits}`;
  return symbol ? `${digits} ${symbol}` : digits;
}

/**
 * Raw token units inside the Steward's stored reasons, as money (QA R25-6, R25-14): "cash 234576799 is below the 1297500000 needed"
 * → "cash $234.58 is below the $1,297.50 needed". Only numbers in the places those reasons put an amount are touched, so a date,
 * a count or a percentage is never read as money. Used for decision records, Steward summaries, the bell, Telegram and push.
 */
export function tidyRawUnits(text: string, symbol = "USDC", decimals = 6): string {
  const m = (raw: string) => showMoney(formatAmount(BigInt(raw), decimals), symbol);
  return text
    .replace(/\b([Cc]ash|[Ee]xcess|[Ff]ee) (\d+)\b(?![.,]\d)(?!\s?(?:days?|hours?|%|bps|percent)\b)/g, (_x, w: string, n: string) => `${w} ${m(n)}`)
    .replace(/\b([Ii]nvoice) (\d+) exceeds\b/g, (_x, w: string, n: string) => `${w} ${m(n)} exceeds`)
    .replace(/\bthe (\d+) (needed|target|sweep threshold|threshold|left on the PO|limit)\b/g, (_x, n: string, w: string) => `the ${m(n)} ${w}`)
    .replace(/\bis (\d+) above\b/g, (_x, n: string) => `is ${m(n)} above`)
    .replace(/; (\d+) stays counted\b/g, (_x, n: string) => `; ${m(n)} stays counted`);
}

/** Lending or reserve shares in words, "58.1385 shares": raw share units at the venue's own decimals, four places at most */
export function showShares(raw: string | bigint, decimals: number): string {
  const [whole = "0", frac = ""] = formatAmount(BigInt(raw), decimals).split(".");
  const short = frac.slice(0, 4).replace(/0+$/, "");
  return `${group(whole)}${short ? `.${short}` : ""} shares`;
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

/** Dollars from raw units: at least two decimals and every real digit after them ("$15.375", never "$15.37"); the same digits as `showMoney` */
export function usd(raw: bigint, decimals = 6): string {
  return `$${showAmount(formatAmount(raw, decimals))}`;
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


/** "0x9145…449e": any long hex value (a change ID, a transaction hash) in the same short form as an address (QA retest 18) */
export function shortHex(value: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return shortAddress(value);
  return /^0x[0-9a-fA-F]{12,}$/.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** Free text with any full address in it shortened ("paid 0x7d9a…", never 42 characters that can't be split): for names and labels, not for places an address is checked */
export function shortenAddressesIn(text: string): string {
  return text.replace(/0x[0-9a-fA-F]{40}\b/g, (a) => shortAddress(a));
}

const MONEY_IN_TEXT = /([$€])((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3,})(?![\d.,]*\d)/g;
const TOKEN_IN_TEXT = /(?<![\d.,$€])((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3,})(\s?(?:USDC|EURC))\b/g;

/**
 * Amounts inside sentences written before money went to two decimals (QA retest 17: an old Ask answer read "operating cash of
 * $510.386"). Only a figure marked as money, with "$"/"€" in front or "USDC"/"EURC" after, and more than two decimals is rounded,
 * half up like `showAmount`; percentages, dates, addresses and plain numbers are left alone. For display only; the stored text,
 * and the facts behind "Show the numbers", keep every digit.
 */
export function tidyMoneyInText(text: string): string {
  return text
    .replace(MONEY_IN_TEXT, (_m, sign: string, n: string) => `${sign}${showAmount(n.replace(/,/g, ""))}`)
    .replace(TOKEN_IN_TEXT, (_m, n: string, unit: string) => `${showAmount(n.replace(/,/g, ""))}${unit}`);
}
