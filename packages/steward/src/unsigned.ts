import type { Extraction } from "./model.js";
import { scanForInstructions } from "./signals.js";

/** A vendor this business already pays (verified relationship) */
export interface KnownVendor {
  seal: string;
  displayName: string;
  legalName?: string;
  email?: string;
  website?: string;
}

export interface UnsignedAssessment {
  /** Unsigned documents are never payable; this says how suspicious it is on top of that */
  verdict: "likely_impersonation" | "unsigned";
  claimsToBe: KnownVendor[];
  reasons: string[];
}

const LEGAL_SUFFIXES = /\b(ltd|limited|llc|inc|gmbh|sarl|sas|bv|plc|co|corp|lda|srl)\b/g;
const normalize = (s: string) => s.toLowerCase().replace(LEGAL_SUFFIXES, "").replace(/[^a-z0-9]+/g, " ").trim();
const domainOf = (email?: string | null) => email?.split("@")[1]?.toLowerCase();

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Flow 6 ("we changed our bank details"): an unsigned invoice that claims to come from a vendor this business already
 * pays, or from a look-alike domain, or that asks for new payment details, is flagged as likely impersonation. It is
 * never paid either way: only Seal-signed invoices are payable, to the payout the Seal signed and the owner confirmed.
 */
export function assessUnsigned(x: Extraction, vendors: readonly KnownVendor[]): UnsignedAssessment {
  const reasons: string[] = [];
  const name = normalize(x.vendorName);
  const fromDomain = domainOf(x.vendorEmail);
  const claimsToBe = vendors.filter((v) => {
    const names = [v.displayName, v.legalName].filter((n): n is string => Boolean(n)).map(normalize);
    const byName = names.some((n) => n.length > 2 && (n === name || name.includes(n) || n.includes(name)));
    const known = domainOf(v.email);
    const lookalike = Boolean(fromDomain && known && fromDomain !== known && editDistance(fromDomain, known) <= 2);
    if (lookalike) reasons.push(`sender domain ${fromDomain} looks like ${known} but isn't`);
    return byName || lookalike;
  });
  if (claimsToBe.length > 0) {
    reasons.push(`claims to be from ${claimsToBe.map((v) => v.displayName).join(", ")}, who always seal their invoices`);
  }
  const instructions = [...x.instructionsFound, ...scanForInstructions(x).map((s) => s.excerpt)];
  if (instructions.length > 0) reasons.push("asks the reader to act (pay now, new account details, skip checks)");
  return { verdict: claimsToBe.length > 0 || instructions.length > 0 ? "likely_impersonation" : "unsigned", claimsToBe, reasons };
}
