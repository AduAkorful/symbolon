import type { Address } from "viem";

export interface PolicyShape {
  perTxCap: bigint;
  autoPayLimit: bigint;
  ownerThreshold: bigint;
  newVendorMinPaid: number | bigint;
  screeningMaxAge: bigint;
  newPayeeDelay: bigint;
  changeCooldown: bigint;
  looseningDelay: bigint;
  maxBridgeFee: bigint;
}

export interface BudgetShape {
  exists: boolean;
  cap: bigint;
  periodLength: bigint;
}

export interface PayeeTermsShape {
  budget: string;
  requirePo: boolean;
  requireDelivery: boolean;
  monthlyCap: bigint;
}

export interface ReservePolicyShape {
  enabled: boolean;
  maxReserveBps: number | bigint;
  minOperating: bigint;
}

/**
 * A screening max age of 0 means "not required", which is the loosest setting.
 * Mirrors `SymbolonVault._screeningLooser`.
 */
export function isScreeningLooser(current: bigint, next: bigint): boolean {
  if (next === 0n) return current !== 0n;
  return current !== 0n && next > current;
}

/**
 * True if any field of `next` is looser than `current`.
 * Mirrors `SymbolonVault._isLoosening(Policy storage current, Policy calldata next)`.
 */
export function isLooseningPolicy(current: PolicyShape, next: PolicyShape): boolean {
  return (
    next.perTxCap > current.perTxCap ||
    next.autoPayLimit > current.autoPayLimit ||
    next.ownerThreshold > current.ownerThreshold ||
    BigInt(next.newVendorMinPaid) < BigInt(current.newVendorMinPaid) ||
    isScreeningLooser(current.screeningMaxAge, next.screeningMaxAge) ||
    next.newPayeeDelay < current.newPayeeDelay ||
    next.changeCooldown < current.changeCooldown ||
    next.looseningDelay < current.looseningDelay ||
    next.maxBridgeFee > current.maxBridgeFee
  );
}

/**
 * Budget is loosening iff the budget exists and (cap increases OR periodLength decreases).
 * Mirrors `SymbolonVault.setBudget`.
 */
export function isLooseningBudget(
  current: BudgetShape,
  next: { cap: bigint; periodLength: bigint },
): boolean {
  return current.exists && (next.cap > current.cap || next.periodLength < current.periodLength);
}

/**
 * Payee terms are loosening iff budget changed, requirePo relaxed, requireDelivery relaxed, or monthlyCap increases.
 * Mirrors `SymbolonVault.updatePayeeTerms`.
 */
export function isLooseningTerms(current: PayeeTermsShape, next: PayeeTermsShape): boolean {
  return (
    next.budget.toLowerCase() !== current.budget.toLowerCase() ||
    (current.requirePo && !next.requirePo) ||
    (current.requireDelivery && !next.requireDelivery) ||
    next.monthlyCap > current.monthlyCap
  );
}

/**
 * Role assignment for approver or requester: loosening iff enabled.
 * Mirrors `SymbolonVault.setApprover` and `setRequester`.
 */
export function isLooseningRole(kind: "approver" | "requester", enabled: boolean): boolean {
  return enabled;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Role assignment for steward or screener address: loosening iff address != address(0).
 * Mirrors `SymbolonVault.setSteward` and `setScreener`.
 */
export function isLooseningAddressRole(
  kind: "steward" | "screener",
  newAddress: Address,
): boolean {
  return newAddress.toLowerCase() !== ZERO_ADDRESS;
}

/**
 * Adding a supported token is loosening; disabling one is tightening.
 * Mirrors `SymbolonVault.setSupportedToken`.
 */
export function isLooseningSupportedToken(supported: boolean): boolean {
  return supported;
}

/**
 * Enabling auto-update is loosening; disabling it is tightening.
 * Mirrors `SymbolonVault.setAutoUpdate`.
 */
export function isLooseningAutoUpdate(enabled: boolean): boolean {
  return enabled;
}

/**
 * Validates a new reserve policy and says whether it loosens the current one.
 * Mirrors `ReserveLogic.checkPolicy`.
 */
export function isLooseningReservePolicy(
  current: ReservePolicyShape,
  next: ReservePolicyShape,
): boolean {
  return (
    (next.enabled && !current.enabled) ||
    BigInt(next.maxReserveBps) > BigInt(current.maxReserveBps) ||
    next.minOperating < current.minOperating
  );
}
