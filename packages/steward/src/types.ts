import type { Address, Hex } from "viem";

/** `ISymbolonVault.Risk` */
export const Risk = { Low: 0, Medium: 1, High: 2, Blocked: 3 } as const;
/** `ISymbolonVault.ApprovalLevel` */
export const ApprovalLevel = { None: 0, Approver: 1, Owner: 2 } as const;
export type ApprovalLevelValue = (typeof ApprovalLevel)[keyof typeof ApprovalLevel];

/** Mirrors `ISymbolonVault.Policy` (raw units of the Vault's accounting decimals; seconds) */
export interface VaultPolicy {
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

export interface PayeeTerms {
  budget: Hex;
  requirePo: boolean;
  requireDelivery: boolean;
  monthlyCap: bigint;
}

/** Mirrors `ISymbolonVault.Payee` as `VaultLens.getPayee` returns it */
export interface Payee {
  exists: boolean;
  paidCount: number;
  payout: Address;
  payoutDomain: number;
  activeAt: bigint;
  retireAt: bigint;
  lastChangeNonce: bigint;
  pendingPayout: Address;
  pendingDomain: number;
  pendingActiveAt: bigint;
  risk: number;
  screenedAt: bigint;
  spendPeriod: bigint;
  spentInPeriod: bigint;
  terms: PayeeTerms;
}

export interface Budget {
  exists: boolean;
  periodLength: bigint;
  periodIndex: bigint;
  cap: bigint;
  spent: bigint;
}

export interface PurchaseOrder {
  open: boolean;
  seal: Address;
  releaseAfter: bigint;
  budget: Hex;
  remaining: bigint;
}

/** Everything the policy mirror needs about one Vault at one moment, read through `VaultLens` */
export interface VaultFacts {
  /** Chain time (seconds) the facts were read at */
  now: bigint;
  paused: boolean;
  policy: VaultPolicy;
  isSupportedToken: (token: Address) => boolean;
  payee: Payee | undefined;
  budget: (id: Hex) => Budget | undefined;
  purchaseOrder: PurchaseOrder | undefined;
  deliveryConfirmed: boolean;
  /** This chain's CCTP domain; payouts to any other domain are burned through CCTP */
  localDomain?: number;
  /** CCTP's per-message burn limit for a token (0 = CCTP can't carry it from this chain, e.g. EURC on Arc testnet) */
  cctpBurnLimit?: (token: Address) => bigint;
}
