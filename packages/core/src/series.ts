import { and, eq, isNull, lte } from "drizzle-orm";
import type { Address, Hex } from "viem";

import { businesses, recurringSeries, seriesInvoices, type Database } from "@symbolon/db";
import { verifySealedInvoice } from "@symbolon/seal";

import { receiveInvoice, vaultFromPayerRef, type Intake } from "./invoices.js";

/**
 * Registers a vendor's pre-sealed series (plan 15). Every period must be genuine, from the same Seal, to the same
 * payer, with strictly increasing issue dates; each is released when its issue date arrives.
 */
export async function createSeries(
  db: Database,
  deployment: { chainId: number; ledger: Address },
  envelopes: readonly string[],
  opts: { businessId?: string; description?: string; expectedSeal?: string } = {},
): Promise<{ id: string; periods: number }> {
  if (envelopes.length === 0) throw new Error("a series needs at least one invoice");
  const checked = await Promise.all(envelopes.map((e) => verifySealedInvoice(e, { expected: deployment })));
  checked.forEach((c, i) => {
    if (!c.ok || !c.invoice) throw new Error(`period ${i + 1} isn't a valid sealed invoice: ${c.issues.map((x) => x.message).join("; ")}`);
  });
  const invoices = checked.map((c) => c.invoice!);
  const first = invoices[0]!;
  if (opts.expectedSeal && first.seal.toLowerCase() !== opts.expectedSeal.toLowerCase()) throw new Error("Series belongs to another vendor's Seal");
  invoices.forEach((inv, i) => {
    if (inv.seal.toLowerCase() !== first.seal.toLowerCase()) throw new Error("every period must be sealed by the same Seal");
    if (inv.payerRef !== first.payerRef) throw new Error("every period must be addressed to the same payer");
    if (i > 0 && inv.issuedAt <= invoices[i - 1]!.issuedAt) throw new Error("periods must have strictly increasing issue dates");
  });

  const payerVault = vaultFromPayerRef(first.payerRef);
  const [business] = payerVault ? await db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.chainId, deployment.chainId), eq(businesses.vault, payerVault.toLowerCase()))) : [];
  if (opts.businessId && opts.businessId !== business?.id) throw new Error("Series business does not match its signed payer");
  return db.transaction(async (tx) => {
    const [series] = await tx
      .insert(recurringSeries)
      .values({ seal: first.seal.toLowerCase(), businessId: business?.id ?? null, description: opts.description ?? null })
      .returning({ id: recurringSeries.id });
    await tx.insert(seriesInvoices).values(
      checked.map((c, i) => ({
        seriesId: series!.id,
        period: i + 1,
        fingerprint: (c.fingerprint as Hex).toLowerCase(),
        envelope: envelopes[i]!,
        releaseAt: new Date(Number(c.invoice!.issuedAt) * 1000),
      })),
    );
    return { id: series!.id, periods: envelopes.length };
  });
}

/** Releases every due, unreleased period of active series into intake, once each */
export async function releaseDue(db: Database, deployment: { chainId: number; ledger: Address }, now: Date,
  scope: { businessId?: string; seal?: string } = {}): Promise<Intake[]> {
  return db.transaction(async (tx) => {
  const due = await tx
    .select({ s: seriesInvoices })
    .from(seriesInvoices)
    .innerJoin(recurringSeries, eq(recurringSeries.id, seriesInvoices.seriesId))
    .where(and(eq(recurringSeries.status, "active"), isNull(seriesInvoices.releasedAt), lte(seriesInvoices.releaseAt, now),
      ...(scope.businessId ? [eq(recurringSeries.businessId, scope.businessId)] : []),
      ...(scope.seal ? [eq(recurringSeries.seal, scope.seal.toLowerCase())] : [])))
    .orderBy(seriesInvoices.releaseAt).limit(100).for("update", { skipLocked: true });
  const out: Intake[] = [];
  for (const { s } of due) {
    const intake = await receiveInvoice(tx as unknown as Database, deployment, s.envelope, "recurring");
    if (intake.status !== "verified") throw new Error("Recurring invoice no longer passes verification; release stopped");
    out.push(intake);
    await tx
      .update(seriesInvoices)
      .set({ releasedAt: now })
      .where(and(eq(seriesInvoices.seriesId, s.seriesId), eq(seriesInvoices.period, s.period)));
  }
  return out;
  });
}
