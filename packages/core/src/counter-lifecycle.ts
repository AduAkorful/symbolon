import { decodeSealedInvoice, deriveInvoice } from "@symbolon/seal";
import { ApprovalLevel, checkPayment, counterFor, type InvoiceContext, type StewardResult } from "@symbolon/steward";

/** A counter follows the same verified invoice, timing and policy inputs as the payment pass. */
export function counterRecommendation(ctx: InvoiceContext, result: StewardResult): { discountBps: number; validUntil: bigint } | undefined {
  if (result.outcome !== "scheduled") return;
  const invoice = deriveInvoice(decodeSealedInvoice(ctx.envelope).document);
  if (ctx.facts.localDomain !== undefined && invoice.payoutDomain !== ctx.facts.localDomain) return;
  for (const option of result.record.options) {
    const assessment = option as { kind?: string; discountBps?: number; payBy?: bigint | string; reasons?: string[] };
    if (assessment.kind !== "offer" || !assessment.reasons?.length || !assessment.reasons.every((reason) => reason.includes("is below the"))) continue;
    const offer = ctx.offers.find((o) => o.discountBps === assessment.discountBps && o.validUntil === BigInt(assessment.payBy!));
    if (!offer) continue;
    const credit = ctx.ledgerRemaining ?? invoice.amount;
    const counter = counterFor({ now: ctx.facts.now, dueDate: invoice.dueDate, credit, options: [],
      offer: { kind: "offer", discountBps: offer.discountBps, payBy: offer.validUntil }, program: ctx.business.program,
      reserveYieldBps: ctx.reserveYieldBps, operatingCash: ctx.operatingCash, buffer: ctx.buffer, earlyPayCommitted: ctx.earlyPayCommitted });
    if (!counter) continue;
    const paid = credit - credit * BigInt(counter.discountBps) / 10_000n;
    const policy = checkPayment(ctx.facts, { invoice, credit, paid, maxFee: 0n, approvalHeld: ApprovalLevel.Owner });
    if (!policy.ok) continue;
    return { ...counter, validUntil: offer.validUntil };
  }
}
