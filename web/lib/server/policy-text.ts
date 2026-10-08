import { policyTemplate, type PolicyTemplate } from "@/lib/policy-template";
import { usd, duration } from "@/lib/format";
import type { VaultPolicy } from "@symbolon/steward";

export { usd, duration, policyTemplate, type PolicyTemplate };


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

export function describePolicyLines(p: VaultPolicy, decimals = 6): string[] {
  const lines = [
    p.newVendorMinPaid === 0
      ? `Auto-pay up to ${usd(p.autoPayLimit, decimals)} to any payee on the list`
      : `Auto-pay up to ${usd(p.autoPayLimit, decimals)} to vendors with ${p.newVendorMinPaid} or more paid ${p.newVendorMinPaid === 1 ? "invoice" : "invoices"}`,
    `Owner signs above ${usd(p.ownerThreshold, decimals)}`,
    `No single payment above ${usd(p.perTxCap, decimals)}`,
    p.screeningMaxAge === 0n ? "Payees aren’t required to be screened" : `Payees screened within ${duration(p.screeningMaxAge)}`,
    p.newPayeeDelay === 0n ? "New payees can be paid at once" : `New payees wait ${duration(p.newPayeeDelay)} before their first payment`,
    p.looseningDelay === 0n ? "Looser changes apply immediately" : `Loosening changes wait ${duration(p.looseningDelay)}`,
    `Payout address and Seal changes wait ${duration(p.changeCooldown)}`,
  ];
  if (p.maxBridgeFee !== undefined && p.maxBridgeFee > 0n) {
    lines.push(`Cross-chain bridge fee up to ${usd(p.maxBridgeFee, decimals)}`);
  }
  return lines;
}

export interface PolicyRuleItem {
  id: keyof VaultPolicy;
  name: string;
  group: string;
  value: bigint | number;
  raw: string;
  formatted: string;
  unit: "$" | "hours" | "days" | "invoices";
  looserWhen: "higher" | "lower";
  note: string;
}

export function describePolicyRuleItems(p: VaultPolicy, decimals = 6): PolicyRuleItem[] {
  return [
    {
      id: "perTxCap",
      name: "Largest single payment",
      group: "Paying without a person",
      value: p.perTxCap,
      raw: p.perTxCap.toString(),
      formatted: usd(p.perTxCap, decimals),
      unit: "$",
      looserWhen: "higher",
      note: "No payment above this, whoever signs",
    },
    {
      id: "ownerThreshold",
      name: "Owner signs above",
      group: "Paying without a person",
      value: p.ownerThreshold,
      raw: p.ownerThreshold.toString(),
      formatted: usd(p.ownerThreshold, decimals),
      unit: "$",
      looserWhen: "higher",
      note: "Between the auto-pay limit and this, a budget’s approver signs",
    },
    {
      id: "autoPayLimit",
      name: "Auto-pay limit",
      group: "Paying without a person",
      value: p.autoPayLimit,
      raw: p.autoPayLimit.toString(),
      formatted: usd(p.autoPayLimit, decimals),
      unit: "$",
      looserWhen: "higher",
      note: `For verified vendors with ${p.newVendorMinPaid} or more paid ${p.newVendorMinPaid === 1 ? "invoice" : "invoices"}`,
    },
    {
      id: "newVendorMinPaid",
      name: "New vendor payment threshold",
      group: "Who gets paid",
      value: p.newVendorMinPaid,
      raw: String(p.newVendorMinPaid),
      formatted: `${p.newVendorMinPaid} ${p.newVendorMinPaid === 1 ? "invoice" : "invoices"}`,
      unit: "invoices",
      looserWhen: "lower",
      note: "First invoices from a new vendor always require human review until this many are paid",
    },
    {
      id: "screeningMaxAge",
      name: "Screening valid for",
      group: "Who gets paid",
      value: p.screeningMaxAge,
      raw: p.screeningMaxAge.toString(),
      formatted: p.screeningMaxAge === 0n ? "Not required" : duration(p.screeningMaxAge),
      unit: "days",
      looserWhen: "higher",
      note: "Payees must have a valid compliance screening within this window",
    },
    {
      id: "newPayeeDelay",
      name: "New payee wait",
      group: "Who gets paid",
      value: p.newPayeeDelay,
      raw: p.newPayeeDelay.toString(),
      formatted: p.newPayeeDelay === 0n ? "No wait" : duration(p.newPayeeDelay),
      unit: "hours",
      looserWhen: "lower",
      note: "Wait time before a newly added payee can receive their first payment",
    },
    {
      id: "changeCooldown",
      name: "Payout & Seal change cooldown",
      group: "Who gets paid",
      value: p.changeCooldown,
      raw: p.changeCooldown.toString(),
      formatted: duration(p.changeCooldown),
      unit: "hours",
      looserWhen: "lower",
      note: "Cooldown delay before payout address or Seal key rotations take effect",
    },
    {
      id: "looseningDelay",
      name: "Loosening delay",
      group: "Changing these rules",
      value: p.looseningDelay,
      raw: p.looseningDelay.toString(),
      formatted: p.looseningDelay === 0n ? "Immediate (0 delay)" : duration(p.looseningDelay),
      unit: "hours",
      looserWhen: "lower",
      note: "Delay before looser limits or rules take effect; tightening applies at once",
    },
    {
      id: "maxBridgeFee",
      name: "Maximum cross-chain bridge fee",
      group: "Cross-chain",
      value: p.maxBridgeFee,
      raw: p.maxBridgeFee.toString(),
      formatted: p.maxBridgeFee === 0n ? "Not permitted" : usd(p.maxBridgeFee, decimals),
      unit: "$",
      looserWhen: "higher",
      note: "Maximum network bridge fee allowed for cross-chain settlement",
    },
  ];
}

export function describe(key: PolicyTemplate | string, p: VaultPolicy): PolicyText {
  if (isTemplate(key)) {
    return { key, ...NAMES[key], lines: describePolicyLines(p) };
  }
  return {
    key: (key as PolicyTemplate) ?? "custom",
    name: "Custom",
    blurb: "A tailored policy enforced by your Vault.",
    lines: describePolicyLines(p),
  };
}

export const TEMPLATES: PolicyTemplate[] = ["starter", "standard", "strict"];

export const describePolicy = (key: PolicyTemplate): PolicyText => describe(key, policyTemplate(key));

export const isTemplate = (v: unknown): v is PolicyTemplate => typeof v === "string" && (TEMPLATES as string[]).includes(v);

