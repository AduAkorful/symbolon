import { BPS_DENOMINATOR, MAX_DISCOUNT_BPS } from "./constants.js";
import { SealError } from "./errors.js";
import type { EarlyPayTier, Invoice } from "./typedData.js";

/**
 * What the payer sends for `credit` at `discountBps`. Mirrors `InvoiceLedger._applyDiscount`: the discount rounds
 * down, so any rounding favours the vendor.
 */
export function applyDiscount(credit: bigint, discountBps: number): bigint {
  if (credit < 0n) throw new SealError("credit is never negative");
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > MAX_DISCOUNT_BPS) {
    throw new SealError(`discount ${discountBps} bps is outside 0..${MAX_DISCOUNT_BPS}`);
  }
  return credit - (credit * BigInt(discountBps)) / BPS_DENOMINATOR;
}

/**
 * The largest signed-curve discount still available at `now` (unix seconds), as the ledger would accept it
 * (`now <= payBy`). Returns undefined when no tier is open.
 */
export function bestTier(invoice: Pick<Invoice, "earlyPay">, now: bigint): { index: number; tier: EarlyPayTier } | undefined {
  let best: { index: number; tier: EarlyPayTier } | undefined;
  invoice.earlyPay.forEach((tier, index) => {
    if (now > tier.payBy || tier.discountBps > MAX_DISCOUNT_BPS) return;
    if (!best || tier.discountBps > best.tier.discountBps) best = { index, tier };
  });
  return best;
}
