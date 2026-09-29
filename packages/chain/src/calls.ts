import {
  encodeFunctionData,
  keccak256,
  type Abi,
  type Account,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type PublicClient,
} from "viem";

import type { Invoice } from "@symbolon/seal";

import { invoiceLedgerAbi, symbolonVaultAbi, vaultFactoryAbi } from "./generated/abis.js";

type Writable = "nonpayable" | "payable";

/** A contract write, described but not sent: hand it to a wallet, simulate it, or encode it */
export interface ContractCall<TAbi extends Abi = Abi> {
  address: Address;
  abi: TAbi;
  functionName: string;
  args: readonly unknown[];
}

export function vaultCall<const F extends ContractFunctionName<typeof symbolonVaultAbi, Writable>>(
  vault: Address,
  functionName: F,
  args: ContractFunctionArgs<typeof symbolonVaultAbi, Writable, F>,
) {
  return { address: vault, abi: symbolonVaultAbi, functionName, args } as const;
}

export function factoryCall<const F extends ContractFunctionName<typeof vaultFactoryAbi, Writable>>(
  factory: Address,
  functionName: F,
  args: ContractFunctionArgs<typeof vaultFactoryAbi, Writable, F>,
) {
  return { address: factory, abi: vaultFactoryAbi, functionName, args } as const;
}

export function ledgerCall<const F extends ContractFunctionName<typeof invoiceLedgerAbi, Writable>>(
  ledger: Address,
  functionName: F,
  args: ContractFunctionArgs<typeof invoiceLedgerAbi, Writable, F>,
) {
  return { address: ledger, abi: invoiceLedgerAbi, functionName, args } as const;
}

/** `DiscountKind` in SealTypes.sol */
export const DiscountKind = { None: 0, Tier: 1, Offer: 2 } as const;

export interface DiscountProof {
  kind: number;
  tierIndex: bigint;
  offerBps: number;
  offerValidUntil: bigint;
  offerSig: Hex;
}

export const noDiscount = (): DiscountProof => ({ kind: DiscountKind.None, tierIndex: 0n, offerBps: 0, offerValidUntil: 0n, offerSig: "0x" });
export const tierDiscount = (tierIndex: number): DiscountProof => ({ ...noDiscount(), kind: DiscountKind.Tier, tierIndex: BigInt(tierIndex) });
export const offerDiscount = (offerBps: number, offerValidUntil: bigint, offerSig: Hex): DiscountProof => ({
  kind: DiscountKind.Offer,
  tierIndex: 0n,
  offerBps,
  offerValidUntil,
  offerSig,
});

export interface SignedApproval {
  signer: Address;
  deadline: bigint;
  signature: Hex;
}

/** `SymbolonVault.pay`: the Vault checks everything again; this only assembles the arguments */
export function payCall(
  vault: Address,
  p: { invoice: Invoice; sealSig: Hex; credit: bigint; discount?: DiscountProof; maxFee?: bigint; decisionHash: Hex },
  approvals: readonly SignedApproval[] = [],
) {
  return vaultCall(vault, "pay", [
    {
      invoice: { ...p.invoice, earlyPay: [...p.invoice.earlyPay] },
      sealSig: p.sealSig,
      credit: p.credit,
      discount: p.discount ?? noDiscount(),
      maxFee: p.maxFee ?? 0n,
      decisionHash: p.decisionHash,
    },
    [...approvals],
  ]);
}

/** Calldata for wallets that take raw transactions (e.g. Circle developer-controlled wallets' contract execution) */
export function toTransaction(call: ContractCall): { to: Address; data: Hex } {
  return { to: call.address, data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never) };
}

/**
 * The id a Vault keys a queued loosening change by: keccak256 of the exact calldata. Repeating the same call after the
 * delay applies it; `VaultLens.queuedChangeEta(vault, id)` says when.
 */
export function changeIdOf(call: ContractCall): Hex {
  return keccak256(toTransaction(call).data);
}

/**
 * Simulates a call on the node (`eth_call`) as `account`. Always use this rather than a local EVM on Arc: USDC moves
 * run through a native precompile only the node executes. Throws with the contract's custom error on revert.
 */
export async function simulateCall(client: PublicClient, call: ContractCall, account: Address | Account) {
  return client.simulateContract({ ...call, account } as never);
}
