import { policyTemplate, type PolicyTemplate } from "@symbolon/core";
import type { VaultPolicy } from "@symbolon/steward";

// Plan 05h, difference 2: what a template says it does is generated from `policyTemplate()`, the same function that builds the
// policy the Vault is created with, so the screen can't drift from what is enforced.

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

export interface PolicyText {
  key: PolicyTemplate;
  name: string;
  blurb: string;
  lines: string[];
}

const NAMES: Record<PolicyTemplate, { name: string; blurb: string }> = {
  starter: { name: "Starter", blurb: "A founder paying a handful of vendors. Fewer people in the loop; every onchain guard still on." },
  standard: { name: "Standard", blurb: "A team with budgets and approvers. The spec’s example policy." },
  strict: { name: "Strict", blurb: "Lower limits and longer delays. New vendors’ first invoices go to a person." },
};

export function describe(key: PolicyTemplate, p: VaultPolicy): PolicyText {
  const lines = [
    `Auto-pay up to ${usd(p.autoPayLimit)} to vendors with ${p.newVendorMinPaid} or more paid ${p.newVendorMinPaid === 1 ? "invoice" : "invoices"}`,
    `Owner signs above ${usd(p.ownerThreshold)}`,
    `No single payment above ${usd(p.perTxCap)}`,
    p.screeningMaxAge === 0n ? "Payees aren’t required to be screened" : `Payees screened within ${duration(p.screeningMaxAge)}`,
    p.newPayeeDelay === 0n ? "New payees can be paid at once" : `New payees wait ${duration(p.newPayeeDelay)} before their first payment`,
    `Loosening changes wait ${duration(p.looseningDelay)}`,
    `Payout address and Seal changes wait ${duration(p.changeCooldown)}`,
  ];
  return { key, ...NAMES[key], lines };
}

export const TEMPLATES: PolicyTemplate[] = ["starter", "standard", "strict"];

export const describePolicy = (key: PolicyTemplate): PolicyText => describe(key, policyTemplate(key));

export const isTemplate = (v: unknown): v is PolicyTemplate => typeof v === "string" && (TEMPLATES as string[]).includes(v);
