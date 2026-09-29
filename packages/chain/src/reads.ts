import type { Address, Hex } from "viem";

import type { SymbolonContracts } from "./contracts.js";

/** What the ledger knows about a fingerprint, with the amount still payable */
export interface InvoiceStatus {
  seen: boolean;
  seal: Address;
  total: bigint;
  credited: bigint;
  cancelled: boolean;
  remaining: bigint;
  paid: boolean;
}

export async function invoiceStatus(contracts: SymbolonContracts, fingerprint: Hex): Promise<InvoiceStatus> {
  const [state, remaining] = await Promise.all([
    contracts.ledger.read.status([fingerprint]),
    contracts.ledger.read.remaining([fingerprint]),
  ]);
  return {
    seen: state.seen,
    seal: state.seal,
    total: state.total,
    credited: state.credited,
    cancelled: state.cancelled,
    remaining,
    paid: state.seen && !state.cancelled && state.credited >= state.total,
  };
}

/** A reserve move's preview from Circle's Teller for this Vault (its limits and fee tier apply) */
export interface ReservePreview {
  out: bigint;
  fee: bigint;
  /** 18-decimal price used */
  price: bigint;
  limitRemaining: bigint;
}

export async function previewSubscribe(contracts: SymbolonContracts, vault: Address, assets: bigint): Promise<ReservePreview> {
  const teller = contracts.teller;
  if (!teller) throw new Error("USYC isn't available on this chain");
  const today = await teller.read.todayTimestamp();
  const [[out, fee, price], limitRemaining] = await Promise.all([
    teller.read.previewDepositData([vault, assets]),
    teller.read.subscriptionLimitRemaining([vault, today]),
  ]);
  return { out, fee, price: BigInt(price), limitRemaining };
}

export async function previewRedeem(contracts: SymbolonContracts, vault: Address, shares: bigint): Promise<ReservePreview> {
  const teller = contracts.teller;
  if (!teller) throw new Error("USYC isn't available on this chain");
  const today = await teller.read.todayTimestamp();
  const [[out, fee, price], limitRemaining] = await Promise.all([
    teller.read.previewRedeemData([vault, shares]),
    teller.read.redemptionLimitRemaining([vault, today]),
  ]);
  return { out, fee, price: BigInt(price), limitRemaining };
}

/** Applies a slippage tolerance (bps) to a previewed amount, rounding down, for `minShares`/`minAssets` */
export function withSlippage(amount: bigint, toleranceBps: number): bigint {
  if (!Number.isInteger(toleranceBps) || toleranceBps < 0 || toleranceBps > 10_000) {
    throw new RangeError(`tolerance ${toleranceBps} bps out of range`);
  }
  return (amount * BigInt(10_000 - toleranceBps)) / 10_000n;
}
