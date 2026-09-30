export type PolicyTemplate = "starter" | "standard" | "strict";

export interface PolicyTemplateShape {
  perTxCap: bigint;
  autoPayLimit: bigint;
  ownerThreshold: bigint;
  newVendorMinPaid: number;
  screeningMaxAge: bigint;
  newPayeeDelay: bigint;
  changeCooldown: bigint;
  looseningDelay: bigint;
  maxBridgeFee: bigint;
}

const HOUR = 3_600n;
const DAY = 24n * HOUR;

/**
 * Starting policies (spec §9); every rule stays editable. Amounts in raw units of the Vault's accounting decimals.
 * - starter: a solo founder paying a few vendors — fewer humans in the loop, still every onchain guard.
 * - standard: spec §9's examples (auto-pay 1,000 for vendors with 3+ paid invoices, owner over 10,000, screening
 *   within 30 days, 72h change cooldown).
 * - strict: lower limits, longer delays, every new vendor's first five invoices reviewed.
 */
export function policyTemplate(template: PolicyTemplate, decimals = 6): PolicyTemplateShape {
  const unit = 10n ** BigInt(decimals);
  const common = { changeCooldown: 72n * HOUR, maxBridgeFee: 5n * unit };
  switch (template) {
    case "starter":
      return {
        ...common,
        perTxCap: 25_000n * unit,
        autoPayLimit: 1_000n * unit,
        ownerThreshold: 10_000n * unit,
        newVendorMinPaid: 1,
        screeningMaxAge: 0n,
        newPayeeDelay: 0n,
        looseningDelay: 12n * HOUR,
      };
    case "standard":
      return {
        ...common,
        perTxCap: 50_000n * unit,
        autoPayLimit: 1_000n * unit,
        ownerThreshold: 10_000n * unit,
        newVendorMinPaid: 3,
        screeningMaxAge: 30n * DAY,
        newPayeeDelay: DAY,
        looseningDelay: DAY,
      };
    case "strict":
      return {
        ...common,
        perTxCap: 10_000n * unit,
        autoPayLimit: 500n * unit,
        ownerThreshold: 5_000n * unit,
        newVendorMinPaid: 5,
        screeningMaxAge: 7n * DAY,
        newPayeeDelay: 2n * DAY,
        looseningDelay: 2n * DAY,
      };
  }
}
