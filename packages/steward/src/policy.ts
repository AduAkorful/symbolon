import { isAddressEqual, zeroAddress, type Address, type Hex } from "viem";

import type { Invoice } from "@symbolon/seal";

import { ApprovalLevel, Risk, type ApprovalLevelValue, type Payee, type VaultFacts } from "./types.js";

const PAYEE_PERIOD = 30n * 86_400n;
const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

/** One Vault rule a payment would break, named after the contract's custom error */
export interface RuleFailure {
  rule: string;
  detail: string;
}

export interface PolicyCheck {
  ok: boolean;
  failures: RuleFailure[];
  /** Sign-off the Vault will demand for this outflow */
  requiredApproval: ApprovalLevelValue;
  /** Budget the payment would be charged to */
  budgetId: Hex;
  outflow: bigint;
}

export interface PaymentIntent {
  invoice: Invoice;
  credit: bigint;
  /** What the payer sends after any signed discount (`ledger.quote`) */
  paid: bigint;
  maxFee: bigint;
  /** Highest sign-off already held: the caller's own level and any signed approvals */
  approvalHeld: ApprovalLevelValue;
}

/** The payout the Vault will use: a pending change counts once its cooldown has passed (`_applyClearedPayoutChange`) */
export function effectivePayout(p: Payee, now: bigint): { payout: Address; domain: number } {
  if (p.pendingActiveAt !== 0n && now >= p.pendingActiveAt) return { payout: p.pendingPayout, domain: p.pendingDomain };
  return { payout: p.payout, domain: p.payoutDomain };
}

export function requiredApproval(facts: VaultFacts, p: Payee, outflow: bigint): ApprovalLevelValue {
  const { policy } = facts;
  if (outflow > policy.ownerThreshold || p.risk === Risk.High) return ApprovalLevel.Owner;
  if (outflow > policy.autoPayLimit || p.paidCount < policy.newVendorMinPaid || p.risk === Risk.Medium) {
    return ApprovalLevel.Approver;
  }
  return ApprovalLevel.None;
}

/**
 * Mirrors `SymbolonVault.pay` rule for rule, in the same order, but collects every failure so the Steward can explain
 * all of them. The node simulation of the real call remains the final word; this is for explaining and for never
 * sending a transaction that is bound to fail.
 */
export function checkPayment(facts: VaultFacts, intent: PaymentIntent): PolicyCheck {
  const { invoice: inv, credit, paid, maxFee } = intent;
  const failures: RuleFailure[] = [];
  const fail = (rule: string, detail: string) => failures.push({ rule, detail });
  const outflow = paid + maxFee;
  let budgetId: Hex = ZERO_BYTES32;
  let approval: ApprovalLevelValue = ApprovalLevel.None;

  if (facts.paused) fail("VaultPaused", "the owner has paused the Vault");
  if (!facts.isSupportedToken(inv.token)) fail("UnsupportedToken", `${inv.token} isn't a payment token of this Vault`);
  if (maxFee > facts.policy.maxBridgeFee) fail("BridgeFeeTooHigh", `fee ${maxFee} over the ${facts.policy.maxBridgeFee} limit`);
  // not a Vault rule: CCTP itself would reject the burn inside the ledger, so the payment would revert
  if (facts.localDomain !== undefined && facts.cctpBurnLimit && inv.payoutDomain !== facts.localDomain) {
    const limit = facts.cctpBurnLimit(inv.token);
    if (limit === 0n) fail("CrossChainTokenUnsupported", `CCTP can't carry ${inv.token} from this chain; pay on this chain or in USDC`);
    else if (paid + maxFee > limit) fail("CrossChainAmountTooLarge", `CCTP carries at most ${limit} per payment`);
  }

  const p = facts.payee;
  if (!p?.exists) {
    fail("UnknownPayee", `${inv.seal} isn't a payee of this Vault`);
  } else {
    if (facts.now < p.activeAt) fail("PayeeNotActive", `payee becomes active at ${p.activeAt}`);
    if (p.retireAt !== 0n && facts.now >= p.retireAt) fail("PayeeRetired", "payee was retired");
    const payout = effectivePayout(p, facts.now);
    if (!isAddressEqual(inv.payoutAddress, payout.payout) || inv.payoutDomain !== payout.domain) {
      fail("PayoutMismatch", `invoice pays ${inv.payoutAddress}@${inv.payoutDomain}, the confirmed payout is ${payout.payout}@${payout.domain}`);
    }
    if (p.risk === Risk.Blocked) fail("PayeeBlocked", "screening blocked this payee");
    const maxAge = facts.policy.screeningMaxAge;
    if (maxAge !== 0n && (p.screenedAt === 0n || facts.now > p.screenedAt + maxAge)) {
      fail("ScreeningStale", "the payee's screening is missing or out of date");
    }

    budgetId = p.terms.budget;
    const po = facts.purchaseOrder;
    const poExists = po !== undefined && !isAddressEqual(po.seal, zeroAddress);
    if (p.terms.requirePo || poExists) {
      if (inv.poRef === ZERO_BYTES32) fail("PurchaseOrderRequired", "this payee's invoices must cite a purchase order");
      else if (!po?.open) fail("PurchaseOrderNotOpen", `PO ${inv.poRef} isn't open`);
      else {
        if (!isAddressEqual(po.seal, inv.seal)) fail("PurchaseOrderWrongVendor", "the PO belongs to another vendor");
        if (facts.now < po.releaseAfter) fail("PurchaseOrderNotReleased", `PO releases at ${po.releaseAfter}`);
        if (credit > po.remaining) fail("PurchaseOrderExceeded", `PO has ${po.remaining} left, invoice needs ${credit}`);
        budgetId = po.budget;
      }
    }
    if (p.terms.requireDelivery && !facts.deliveryConfirmed) fail("DeliveryNotConfirmed", "delivery hasn't been confirmed");

    if (outflow > facts.policy.perTxCap) fail("PerTxCapExceeded", `${outflow} over the per-payment cap ${facts.policy.perTxCap}`);
    const spent = p.spendPeriod === facts.now / PAYEE_PERIOD ? p.spentInPeriod : 0n;
    if (spent + outflow > p.terms.monthlyCap) fail("PayeeCapExceeded", `payee cap ${p.terms.monthlyCap}, ${spent} already spent this period`);
    const b = facts.budget(budgetId);
    if (!b?.exists) fail("UnknownBudget", `budget ${budgetId} doesn't exist`);
    else {
      const bSpent = b.periodIndex === facts.now / b.periodLength ? b.spent : 0n;
      if (bSpent + outflow > b.cap) fail("BudgetExceeded", `budget cap ${b.cap}, ${bSpent} already spent`);
    }

    approval = requiredApproval(facts, p, outflow);
    if (intent.approvalHeld < approval) fail("ApprovalRequired", approval === ApprovalLevel.Owner ? "needs the owner's sign-off" : "needs an approver's sign-off");
  }

  return { ok: failures.length === 0, failures, requiredApproval: approval, budgetId, outflow };
}
