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

import { getAddress } from "viem";
import { releases, type ReleaseInfo } from "./generated/releases.js";

/** Looks up verified release notes for a given implementation address, if known */
export function getReleaseNotes(implementation: string): ReleaseInfo | undefined {
  try {
    const checksummed = getAddress(implementation);
    return (releases as Record<string, ReleaseInfo>)[checksummed];
  } catch {
    return undefined;
  }
}


/**
 * Every Vault factory the registry's releases have used on a chain, with the block it was published at. A factory's implementation is
 * immutable, so each release has its own, and Vaults made by an older one still exist: counting Vaults means reading all of them.
 */
export function vaultFactories(chainId: number): { factory: Address; startBlock: bigint }[] {
  const seen = new Map<string, { factory: Address; startBlock: bigint }>();
  for (const r of Object.values(releases) as ReleaseInfo[]) {
    if (r.chainId !== chainId) continue;
    const key = r.factory.toLowerCase();
    const known = seen.get(key);
    const startBlock = BigInt(r.startBlock);
    if (!known || startBlock < known.startBlock) seen.set(key, { factory: getAddress(r.factory), startBlock });
  }
  return [...seen.values()];
}
