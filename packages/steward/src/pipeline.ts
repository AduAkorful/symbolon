import type { Address, Hex } from "viem";

import {
  noDiscount,
  offerDiscount,
  payCall,
  tierDiscount,
  type ContractCall,
  type DiscountProof,
  type SignedApproval,
} from "@symbolon/chain";
import { decodeSealedInvoice, verifySealedInvoice, type Invoice, type SignatureClient } from "@symbolon/seal";

import { findDuplicates, matchInvoice, type KnownInvoice } from "./match.js";
import type { StewardModel } from "./model.js";
import { checkPayment } from "./policy.js";
import { hashRecord, toRecordValue, type DecisionRecord } from "./records.js";
import { scanForInstructions } from "./signals.js";
import { decideTiming, tierOptions, type DiscountOption, type EarlyPayProgram } from "./timing.js";
import { ApprovalLevel, type ApprovalLevelValue, type VaultFacts } from "./types.js";

export type StewardMode = "shadow" | "assist" | "auto";

export type Outcome =
  | "rejected" // not a genuine, consistent sealed invoice
  | "already_settled"
  | "held" // needs a human: instructions in the document, duplicates, matching problems, policy failures
  | "scheduled" // pay on the due date
  | "awaiting_approval"
  | "proposed" // shadow/assist: would pay now
  | "refused" // the node simulation says the Vault would reject it
  | "paid";

/** A Seal-signed cash-now offer for this invoice (already verified by the ledger's rules when used) */
export interface SignedOffer {
  discountBps: number;
  validUntil: bigint;
  signature: Hex;
}

export interface InvoiceContext {
  business: { id: string; vault: Address; mode: StewardMode; program: EarlyPayProgram };
  deployment: { chainId: number; ledger: Address };
  /** The sealed envelope as received */
  envelope: string | unknown;
  facts: VaultFacts;
  /** What the ledger says is still payable on this fingerprint (undefined if the ledger hasn't seen it) */
  ledgerRemaining: bigint | undefined;
  knownInvoices: readonly KnownInvoice[];
  offers: readonly SignedOffer[];
  reserveYieldBps: number;
  operatingCash: bigint;
  buffer: bigint;
  earlyPayCommitted: bigint;
  /** Sign-off already held: approvals collected so far (the steward itself counts as none) */
  approvalHeld: ApprovalLevelValue;
  /** The signed approvals behind `approvalHeld`; the Vault verifies each one */
  approvals?: readonly SignedApproval[];
  /** Business-side block state is an immediate hold even though the Vault payee itself is unchanged. */
  blockedSeal?: boolean;
  signatureClient?: SignatureClient;
}

export interface Deps {
  model?: StewardModel;
  /** Node simulation of a call as the Steward; throws with the contract error if it would revert */
  simulate: (call: ContractCall) => Promise<unknown>;
  send?: (call: ContractCall) => Promise<Hex>;
}

export interface StewardResult {
  outcome: Outcome;
  record: DecisionRecord;
  hash: Hex;
  call?: ContractCall;
  txHash?: Hex;
}

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

/**
 * One invoice through the Steward: verify → read for instructions → duplicates → match → timing → policy mirror →
 * record → act according to the mode. Every path, including declines, produces a decision record.
 */
export async function processInvoice(ctx: InvoiceContext, deps: Deps): Promise<StewardResult> {
  const { business, facts } = ctx;
  const base = { version: 1 as const, business: business.id, at: iso(facts.now), mode: business.mode };

  const finish = async (outcome: Outcome, record: Omit<DecisionRecord, keyof typeof base>, extra: Partial<StewardResult> = {}) => {
    // plain JSON from here on (bigints as decimal strings), so the record stores, hashes and displays identically
    let full = toRecordValue({ ...base, ...record }) as DecisionRecord;
    if (deps.model) {
      try {
        full = { ...full, explanation: await deps.model.explain(full) };
      } catch {
        // an explanation is a courtesy; the record stands without one
      }
    }
    const { hash } = hashRecord(full);
    return { outcome, record: full, hash, ...extra };
  };

  // 1. genuine, consistent, sealed for our ledger?
  const verification = await verifySealedInvoice(ctx.envelope, {
    expected: { chainId: ctx.deployment.chainId, ledger: ctx.deployment.ledger },
    ...(ctx.signatureClient ? { client: ctx.signatureClient } : {}),
  });
  if (!verification.ok || !verification.invoice || !verification.fingerprint) {
    return finish("rejected", {
      kind: "reject",
      ...(verification.fingerprint ? { subject: verification.fingerprint } : {}),
      inputs: { issues: verification.issues },
      options: [],
      rule: "only genuine, consistent invoices sealed for this ledger are payable",
      outcome: "rejected",
    });
  }
  const inv: Invoice = verification.invoice;
  const fp = verification.fingerprint;
  const subject = fp;

  if (ctx.blockedSeal) {
    return finish("held", {
      kind: "hold",
      subject,
      inputs: { seal: inv.seal },
      options: [],
      rule: "this business has blocked the vendor Seal; owner review is required",
      outcome: "held",
    });
  }

  // 2. documents are data
  const signals = scanForInstructions(verification.document);
  if (signals.length > 0) {
    return finish("held", {
      kind: "hold",
      subject,
      inputs: { signals },
      options: [],
      rule: "instruction-like text in a document is a risk signal; a human must review it",
      outcome: "held",
    });
  }

  // 3. already settled or cancelled onchain?
  if (ctx.ledgerRemaining === 0n) {
    return finish("already_settled", { kind: "skip", subject, inputs: { remaining: 0n }, options: [], rule: "pay once", outcome: "already_settled" });
  }

  // 4. duplicates
  const dupes = findDuplicates(
    { fingerprint: fp, seal: inv.seal, invoiceNumber: verification.document?.invoiceNumber ?? "", amount: inv.amount, issuedAt: inv.issuedAt },
    ctx.knownInvoices,
  );
  if (dupes.length > 0) {
    return finish("held", {
      kind: "hold",
      subject,
      inputs: { duplicates: dupes },
      options: [],
      rule: "possible duplicates are held for a human with both invoices side by side",
      outcome: "held",
    });
  }

  // 5. match against payee terms, PO and delivery
  const match = matchInvoice(inv, facts.payee?.exists ? facts.payee.terms : undefined, facts.purchaseOrder, facts.deliveryConfirmed, facts.now);
  if (!match.ok) {
    return finish("held", { kind: "hold", subject, inputs: { match }, options: [], rule: `${match.kind} match required`, outcome: "held" });
  }

  // 6. timing
  const credit = ctx.ledgerRemaining ?? inv.amount;
  const offerOptions: DiscountOption[] = ctx.offers.map((o) => ({ kind: "offer", discountBps: o.discountBps, payBy: o.validUntil }));
  const timing = decideTiming({
    now: facts.now,
    dueDate: inv.dueDate,
    credit,
    options: [...tierOptions(inv.earlyPay), ...offerOptions],
    reserveYieldBps: ctx.reserveYieldBps,
    program: business.program,
    operatingCash: ctx.operatingCash,
    buffer: ctx.buffer,
    earlyPayCommitted: ctx.earlyPayCommitted,
  });
  const options = timing.assessed.map((a) => ({ ...a.option, paid: a.paid, annualizedBps: a.annualizedBps, clears: a.clears, reasons: a.reasons }));

  if (timing.action === "pay_on_due_date") {
    return finish("scheduled", {
      kind: "schedule",
      subject,
      inputs: { credit, dueDate: inv.dueDate, reserveYieldBps: ctx.reserveYieldBps },
      options,
      rule: "pay on the due date unless a signed discount beats the reserve yield plus the owner's spread",
      outcome: `scheduled for ${iso(timing.payAt)}`,
    });
  }

  let discount: DiscountProof = noDiscount();
  let paid = credit;
  if (timing.action === "pay_now_discounted") {
    paid = timing.paid;
    const o = timing.option;
    if (o.kind === "tier") discount = tierDiscount(o.tierIndex ?? 0);
    else {
      const offer = ctx.offers.find((x) => x.discountBps === o.discountBps && x.validUntil === o.payBy);
      if (!offer) throw new Error("chosen offer not found");
      discount = offerDiscount(offer.discountBps, offer.validUntil, offer.signature);
    }
  }

  // 7. the Vault's rules, mirrored
  const policy = checkPayment(facts, { invoice: inv, credit, paid, maxFee: 0n, approvalHeld: ctx.approvalHeld });
  const inputs = { credit, paid, policy, timing: timing.action };
  const onlyNeedsApproval = policy.failures.length > 0 && policy.failures.every((f) => f.rule === "ApprovalRequired");
  if (!policy.ok && !onlyNeedsApproval) {
    return finish("held", { kind: "hold", subject, inputs, options, rule: "the Vault would refuse this payment", outcome: "held" });
  }
  if (onlyNeedsApproval) {
    return finish("awaiting_approval", {
      kind: "request_approval",
      subject,
      inputs,
      options,
      rule: policy.requiredApproval === ApprovalLevel.Owner ? "owner sign-off required" : "approver sign-off required",
      outcome: "awaiting_approval",
    });
  }

  // A13: cross-chain payouts are held until a fee is quoted (stricter, safe)
  if (facts.localDomain !== undefined && inv.payoutDomain !== facts.localDomain) {
    return finish("held", {
      kind: "hold",
      subject,
      inputs: { ...inputs, payoutDomain: inv.payoutDomain, localDomain: facts.localDomain },
      options,
      rule: "cross-chain payouts need a fee quote the Steward doesn't fetch yet",
      outcome: "held",
    });
  }

  // 8. act by mode; the record hash travels with the transaction
  const recordBody = {
    kind: "pay",
    subject,
    inputs,
    options,
    rule: timing.action === "pay_now_discounted" ? "signed discount clears the hurdle, buffer and cap" : "invoice is due",
    outcome: business.mode === "auto" ? "paying" : "proposed",
  };
  const draft = await finish(business.mode === "auto" ? "paid" : "proposed", recordBody);
  const sealSig = decodeSealedInvoice(ctx.envelope).signature;
  const call = payCall(business.vault, { invoice: inv, sealSig, credit, discount, decisionHash: draft.hash }, ctx.approvals ?? []);
  if (business.mode !== "auto" || !deps.send) return { ...draft, outcome: "proposed", call };

  try {
    await deps.simulate(call);
  } catch (error) {
    return finish("refused", {
      kind: "refuse",
      subject,
      inputs: { ...inputs, simulation: String((error as Error).message ?? error).slice(0, 500), decision: draft.hash },
      options,
      rule: "never send a transaction the Vault would reject",
      outcome: "refused",
    });
  }
  const txHash = await deps.send(call);
  return { ...draft, call, txHash };
}
