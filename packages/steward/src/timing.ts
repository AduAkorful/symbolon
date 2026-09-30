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

export interface CounterInputs extends TimingInputs {
  offer: DiscountOption;
}

/**
 * Returns the smallest discount >= the vendor's offer that clears every bar decideTiming uses
 * (hurdle = reserve yield + spread, buffer, cash cap, <= MAX_DISCOUNT_BPS), or undefined if none clears
 * or the offer already clears on its own.
 */
export function counterFor(i: CounterInputs): { discountBps: number } | undefined {
  if (!i.program.enabled) return undefined;
  if (i.dueDate <= i.now) return undefined;
  if (i.now > i.offer.payBy) return undefined;

  const hurdle = BigInt(i.reserveYieldBps + i.program.minSpreadBps);
  const cap = (i.operatingCash * BigInt(i.program.cashCapBps)) / BPS;

  const daysEarly = (i.dueDate - i.now) / DAY;
  const days = daysEarly < 1n ? 1n : daysEarly;

  // Smallest discount meeting hurdle: (d * 365) / days >= hurdle
  const hurdleBps = Number((hurdle * days + YEAR_DAYS - 1n) / YEAR_DAYS);
  let targetBps = Math.max(i.offer.discountBps, hurdleBps);

  if (targetBps > MAX_DISCOUNT_BPS) return undefined;

  // If the offer already meets hurdle, buffer, and cap, no counter is needed
  const offerPaid = applyDiscount(i.credit, i.offer.discountBps);
  const offerClears =
    i.offer.discountBps >= hurdleBps &&
    i.operatingCash - offerPaid >= i.buffer &&
    i.earlyPayCommitted + offerPaid <= cap;
  if (offerClears) return undefined;

  // Find smallest d >= targetBps that also clears buffer and cap
  const maxAllowedPaid = [i.operatingCash - i.buffer, cap - i.earlyPayCommitted].reduce(
    (min, v) => (v < min ? v : min),
  );
  if (maxAllowedPaid < 0n) return undefined;

  if (i.credit > maxAllowedPaid) {
    const neededSaving = i.credit - maxAllowedPaid;
    // saving = (credit * d) / 10000 >= neededSaving => d >= (neededSaving * 10000 + credit - 1) / credit
    const neededBps = Number((neededSaving * BPS + i.credit - 1n) / i.credit);
    targetBps = Math.max(targetBps, neededBps);
  }

  // If targetBps didn't strictly exceed offer, but offer didn't clear earlier, target must strictly improve the discount
  if (targetBps <= i.offer.discountBps) {
    targetBps = i.offer.discountBps + 1;
  }

  if (targetBps > MAX_DISCOUNT_BPS) return undefined;

  const finalPaid = applyDiscount(i.credit, targetBps);
  if (i.operatingCash - finalPaid < i.buffer) return undefined;
  if (i.earlyPayCommitted + finalPaid > cap) return undefined;

  return { discountBps: targetBps };
}

