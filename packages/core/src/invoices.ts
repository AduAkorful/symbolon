import { and, eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";

import { businesses, invoices, type Database } from "@symbolon/db";
import { encodeSealedInvoice, verifySealedInvoice, type Issue, type SignatureClient } from "@symbolon/seal";

export type InvoiceSource = "link" | "email" | "upload" | "api" | "recurring";

export interface Intake {
  status: "verified" | "rejected";
  fingerprint?: Hex;
  issues: Issue[];
  /** True when this fingerprint was already on file (nothing was changed) */
  duplicate: boolean;
  businessId?: string;
}

/** The payer's Vault when `payerRef` is an address left-padded to 32 bytes (see `payerRef()` in @symbolon/seal) */
export function vaultFromPayerRef(payerRef: Hex): Address | undefined {
  return /^0x0{24}[0-9a-f]{40}$/i.test(payerRef) ? getAddress(`0x${payerRef.slice(26)}`) : undefined;
}

/**
 * Receives a sealed invoice from any channel: verifies it against the deployment, stores verified envelopes once per
 * fingerprint, and links them to the payer business when the payer is a Symbolon Vault. Rejected submissions are
 * returned with their issues but are never stored under the fingerprint: the fingerprint does not include the signature,
 * so storing a bad signature could reserve the place a genuine submission needs.
 */
export async function receiveInvoice(
  db: Database,
  deployment: { chainId: number; ledger: Address },
  envelope: string | unknown,
  source: InvoiceSource,
  opts: { signatureClient?: SignatureClient } = {},
): Promise<Intake> {
  const v = await verifySealedInvoice(envelope, {
    expected: deployment,
    ...(opts.signatureClient ? { client: opts.signatureClient } : {}),
  });
  if (!v.fingerprint || !v.invoice || !v.document) return { status: "rejected", issues: v.issues, duplicate: false };

  const [existing] = await db
    .select({ fingerprint: invoices.fingerprint, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.fingerprint, v.fingerprint))
    .limit(1);

  // A valid resubmission may repair a rejected row created before this rule was introduced. A verified-or-later row
  // is never overwritten, and an invalid resubmission never changes anything.
  if (existing && (existing.status !== "rejected" || !v.ok)) {
    return { status: v.ok ? "verified" : "rejected", fingerprint: v.fingerprint, issues: v.issues, duplicate: true };
  }
  if (!v.ok) return { status: "rejected", fingerprint: v.fingerprint, issues: v.issues, duplicate: false };

  const payerVault = vaultFromPayerRef(v.invoice.payerRef);
  const [business] = payerVault
    ? await db
        .select({ id: businesses.id })
        .from(businesses)
        .where(and(eq(businesses.chainId, deployment.chainId), eq(businesses.vault, payerVault.toLowerCase())))
    : [];

  // This point is only reachable for a newly verified invoice or a verified replacement of a legacy rejected row.
  const status = "verified" as const;
  const canonical = typeof envelope === "string" ? envelope : encodeSealedInvoice(envelope as never);
  const values = {
    fingerprint: v.fingerprint,
    chainId: deployment.chainId,
    ledger: deployment.ledger.toLowerCase(),
    seal: v.invoice.seal.toLowerCase(),
    businessId: business?.id ?? null,
    payerRef: v.invoice.payerRef,
    invoiceNumber: v.document.invoiceNumber,
    token: v.invoice.token.toLowerCase(),
    total: v.invoice.amount,
    dueDate: new Date(Number(v.invoice.dueDate) * 1000),
    issuedAt: new Date(Number(v.invoice.issuedAt) * 1000),
    poRef: v.invoice.poRef,
    replaces: v.invoice.replaces,
    envelope: canonical,
    status,
    issues: v.issues,
    source,
  };

  if (existing) {
    await db.update(invoices).set(values).where(and(eq(invoices.fingerprint, v.fingerprint), eq(invoices.status, "rejected")));
    return { status, fingerprint: v.fingerprint, issues: v.issues, duplicate: false, ...(business ? { businessId: business.id } : {}) };
  }

  const inserted = await db.insert(invoices).values(values).onConflictDoNothing().returning({ fingerprint: invoices.fingerprint });
  if (inserted.length === 0) {
    return { status, fingerprint: v.fingerprint, issues: v.issues, duplicate: true, ...(business ? { businessId: business.id } : {}) };
  }
  return { status, fingerprint: v.fingerprint, issues: v.issues, duplicate: false, ...(business ? { businessId: business.id } : {}) };
}
