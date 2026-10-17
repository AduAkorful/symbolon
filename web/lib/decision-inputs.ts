import { formatAmount } from "@symbolon/seal";

import { describeRule } from "./blockers";
import { formatDateTime, showBps, showDate, showMoney, showShares, shortHex, tidyRawUnits } from "./format";

/**
 * A decision record's stored values, in words (QA retest 19). The record page showed "credit 41150000", "dueDate 1793119755",
 * blockers as JSON and "scheduled for 2026-10-27T16:49:15.000Z". The record itself is never changed (it is hashed and anchored):
 * these helpers only decide how it is read, and the page keeps every raw value behind "Show raw" for an audit.
 */

const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
const HAS_ISO = new RegExp(ISO.source);

/** "scheduled for 2026-10-27T16:49:15.000Z" → "Scheduled for 27 Oct, 16:49 UTC"; "awaiting_approval" → "Awaiting approval" */
export function formatOutcome(outcome: string, opts: { now?: Date } = {}): string {
  const text = outcome.replace(ISO, (iso) => formatDateTime(iso, opts)).replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export interface InputRow {
  /** The stored key, unchanged */
  key: string;
  label: string;
  /** The value in words */
  value: string;
  /** The value exactly as stored, for "Show raw" */
  raw: string;
}

const LABELS: Record<string, string> = {
  credit: "Amount owed",
  paid: "Amount to pay",
  amount: "Amount",
  assets: "Amount",
  remaining: "Left to pay",
  dueDate: "Due date",
  validUntil: "Valid until",
  payBy: "Pay by",
  eta: "Ready to apply",
  reserveYieldBps: "Reserve yield",
  discountBps: "Discount",
  blockers: "What stood in the way",
  policy: "Vault rules check",
  timing: "Timing",
  offer: "Offer",
  payoutAddress: "Payout address",
  latestScreenedAddress: "Last screened address",
  payoutDomain: "Pays on network",
  localDomain: "This network",
  duplicates: "Possible duplicates",
  match: "Order match",
  issues: "Verification issues",
  signals: "Screening signals",
  seal: "Vendor Seal",
  simulation: "Vault simulation",
  decision: "Decision",
  decisionHash: "Decision",
  recommendation: "Recommendation",
  txHash: "Transaction",
  venue: "Lending vault",
  token: "Currency",
  from: "From",
  to: "To",
  actor: "By",
  lendingValue: "Lending value",
  redeemable: "Can be taken out now",
  simulated: "Simulated payout",
  minAssets: "Least it will accept",
  minShares: "Fewest shares it will accept",
  quoted: "Shares quoted",
  unavailable: "Can't be taken out now",
  minOperating: "Operating floor",
  valueKnown: "Value readable",
  maxLendingBps: "Most in lending",
  asset: "Currency",
};

const MONEY_KEYS = new Set([
  "credit", "paid", "amount", "assets", "remaining", "limit", "cap", "billsDue", "cash",
  // lending and reserve records (QA R25-6): every one of these is raw USDC units
  "lendingValue", "redeemable", "simulated", "minAssets", "unavailable", "minOperating", "reserveValue", "buffer", "upcoming", "minSweep",
]);
/** Raw share units of a lending vault or the reserve: shown as shares at the venue's decimals, never as a 20-digit number */
const SHARE_KEYS = new Set(["shares", "minShares", "quoted"]);
const UNIX_KEYS = new Set(["dueDate", "validUntil", "payBy", "activeAt"]);
const BPS_KEYS = /Bps$/;

const TIMING: Record<string, string> = {
  pay_on_due_date: "Pay on the due date",
  pay_now_discounted: "Pay now at a discount",
  pay_now: "Pay now",
};

/** "reserveYieldBps" → "Reserve yield bps" for a key with no label of its own */
function humanKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function rawText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  if (v === undefined) return "";
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 1) ?? String(v);
}

const isIntegerText = (v: unknown): v is string | number | bigint =>
  (typeof v === "string" && /^-?\d+$/.test(v)) || (typeof v === "number" && Number.isInteger(v)) || typeof v === "bigint";

function money(v: string | number | bigint, symbol: string): string {
  return showMoney(formatAmount(BigInt(v), 6), symbol);
}

function blockerSentence(b: unknown): string {
  if (b && typeof b === "object" && typeof (b as { rule?: unknown }).rule === "string") {
    const { rule, detail } = b as { rule: string; detail?: unknown };
    const described = describeRule({ rule, detail: typeof detail === "string" ? detail : "" }, { seal: "" });
    return `${described.title}.`;
  }
  return typeof b === "string" ? b : rawText(b);
}

/** One value in words: money at two decimals, dates formatted, blockers as sentences, long hex shortened */
export function formatInputValue(key: string, v: unknown, symbol = "USDC", opts: { now?: Date; shareDecimals?: number } = {}): string {
  if (v === null || v === undefined || v === "") return "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY_KEYS.has(key) && isIntegerText(v)) return money(v, symbol);
  if (SHARE_KEYS.has(key) && isIntegerText(v)) return showShares(BigInt(v), opts.shareDecimals ?? 6);
  if (UNIX_KEYS.has(key) && isIntegerText(v)) return showDate(Number(v));
  if (BPS_KEYS.test(key) && isIntegerText(v)) return `${showBps(Number(v))}%`;
  if (key === "timing" && typeof v === "string") return TIMING[v] ?? humanKey(v);
  if (key === "blockers" || key === "failures") {
    const list = Array.isArray(v) ? v : [];
    return list.length === 0 ? "Nothing" : list.map(blockerSentence).join(" ");
  }
  // a payment's rules check carries ok/failures; a lending policy ({ enabled, maxLendingBps, venue }) is read like any object
  if (key === "policy" && typeof v === "object" && !Array.isArray(v) && ("ok" in (v as object) || "failures" in (v as object))) {
    const p = v as { ok?: unknown; failures?: unknown };
    const failures = Array.isArray(p.failures) ? p.failures : [];
    if (p.ok === true || failures.length === 0) return "Every Vault rule passes.";
    return `Would stop it: ${failures.map(blockerSentence).join(" ")}`;
  }
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]{12,}$/.test(v)) return shortHex(v);
    if (HAS_ISO.test(v)) return v.replace(ISO, (iso) => formatDateTime(iso, opts));
    // "cash 234576799 is below the 1297500000 needed" → "cash $234.58 is below the $1,297.50 needed" (QA R25-6)
    return key === "reason" ? tidyRawUnits(v) : v;
  }
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? "None" : v.map((x) => formatInputValue(key, x, symbol, opts)).join("; ");
  // a small object (an offer, an order match): each part in words
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${LABELS[k] ?? humanKey(k)}: ${formatInputValue(k, x, symbol, opts)}`)
    .join(" · ");
}

/** Every stored input, labelled and in words, with its raw text kept beside it */
export function describeInputs(
  inputs: Record<string, unknown>,
  symbol = "USDC",
  opts: { now?: Date; people?: Record<string, string>; shareDecimals?: number } = {},
): InputRow[] {
  return Object.entries(inputs).map(([key, v]) => ({
    key,
    label: LABELS[key] ?? humanKey(key),
    // a person is named, never shown as their id (QA R25-5); the id stays under "Show raw"
    value: key === "actor" && typeof v === "string" && opts.people?.[v] ? opts.people[v]! : formatInputValue(key, v, symbol, opts),
    raw: rawText(v),
  }));
}
