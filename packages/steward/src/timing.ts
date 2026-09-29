import type { EarlyPayTier } from "@symbolon/seal";
import { applyDiscount, MAX_DISCOUNT_BPS } from "@symbolon/seal";

const DAY = 86_400n;
const BPS = 10_000n;
const YEAR_DAYS = 365n;

/** The owner's Early Pay program (spec §8.3, §9) */
export interface EarlyPayProgram {
  enabled: boolean;
  /** Only take a discount whose annualized return beats the reserve yield by at least this (bps) */
  minSpreadBps: number;
  /** Early payments may commit at most this share of operating cash (bps) */
  cashCapBps: number;
}

export const DEFAULT_EARLY_PAY: EarlyPayProgram = { enabled: true, minSpreadBps: 300, cashCapBps: 2_000 };

export interface DiscountOption {
  kind: "tier" | "offer";
  tierIndex?: number;
  discountBps: number;
  /** Last moment the discount can be taken */
  payBy: bigint;
}

export interface TimingInputs {
  now: bigint;
  dueDate: bigint;
  credit: bigint;
  options: readonly DiscountOption[];
  /** Current reserve (USYC) yield, annualized bps; 0 when the business holds no reserve */
  reserveYieldBps: number;
  program: EarlyPayProgram;
  /** USDC in the Vault now */
  operatingCash: bigint;
  /** Cash that must stay after paying: the forecast buffer (next N days of bills, excluding this one) */
  buffer: bigint;
  /** Early-pay cash already committed in the current period */
  earlyPayCommitted: bigint;
}

export interface OptionAssessment {
  option: DiscountOption;
  paid: bigint;
  saving: bigint;
  daysEarly: bigint;
  /** Annualized return in bps (integer, rounded down) */
  annualizedBps: bigint;
  hurdleBps: bigint;
  clears: boolean;
  reasons: string[];
}

export type TimingDecision =
  | { action: "pay_now_discounted"; option: DiscountOption; paid: bigint; assessment: OptionAssessment; assessed: OptionAssessment[] }
  | { action: "pay_on_due_date"; payAt: bigint; assessed: OptionAssessment[] }
  | { action: "pay_now_overdue"; assessed: OptionAssessment[] };

/**
 * Annualized return of paying `daysEarly` days early for `discountBps`: `bps × 365 / days`. Paying on the day a
 * discount is offered but only hours early still counts as one day.
 */
export function annualizedBps(discountBps: number, daysEarly: bigint): bigint {
  const days = daysEarly < 1n ? 1n : daysEarly;
  return (BigInt(discountBps) * YEAR_DAYS) / days;
}

/**
 * Deterministic Early Pay decision (plan 00 §5, spec §8.3). Takes the best discount that clears every bar; otherwise
 * pays on the due date. Never pays a discount the vendor didn't sign (options come from the sealed invoice's curve or
 * a Seal-signed offer), and the ledger re-checks every discount onchain.
 */
export function decideTiming(i: TimingInputs): TimingDecision {
  const hurdle = BigInt(i.reserveYieldBps + i.program.minSpreadBps);
  const cap = (i.operatingCash * BigInt(i.program.cashCapBps)) / BPS;
  const assessed = i.options.map((option): OptionAssessment => {
    const reasons: string[] = [];
    const paid = applyDiscount(i.credit, Math.min(option.discountBps, MAX_DISCOUNT_BPS));
    const daysEarly = i.dueDate > i.now ? (i.dueDate - i.now) / DAY : 0n;
    const annual = annualizedBps(option.discountBps, daysEarly);
    if (!i.program.enabled) reasons.push("Early Pay is off for this business");
    if (option.discountBps > MAX_DISCOUNT_BPS) reasons.push("discount above the ledger's maximum");
    if (i.now > option.payBy) reasons.push("the discount has expired");
    if (i.dueDate <= i.now) reasons.push("already due: nothing to gain by paying early");
    if (annual < hurdle) reasons.push(`annualized ${annual} bps is below the ${hurdle} bps hurdle (reserve yield + spread)`);
    if (i.operatingCash - paid < i.buffer) reasons.push("paying now would dip below the forecast buffer");
    if (i.earlyPayCommitted + paid > cap) reasons.push("over the cap on cash committed to early payments");
    return { option, paid, saving: i.credit - paid, daysEarly, annualizedBps: annual, hurdleBps: hurdle, clears: reasons.length === 0, reasons };
  });

  const best = assessed.filter((a) => a.clears).sort((a, b) => (a.saving === b.saving ? 0 : a.saving > b.saving ? -1 : 1))[0];
  if (best) return { action: "pay_now_discounted", option: best.option, paid: best.paid, assessment: best, assessed };
  if (i.dueDate <= i.now) return { action: "pay_now_overdue", assessed };
  return { action: "pay_on_due_date", payAt: i.dueDate, assessed };
}

/** The signed curve as discount options */
export function tierOptions(tiers: readonly EarlyPayTier[]): DiscountOption[] {
  return tiers.map((t, tierIndex) => ({ kind: "tier", tierIndex, discountBps: t.discountBps, payBy: t.payBy }));
}
