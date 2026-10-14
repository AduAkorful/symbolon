import "server-only";

import { and, eq } from "drizzle-orm";

import { earlyPayOffers, invoices, type Database } from "@symbolon/db";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { UNSAFE_TEXT } from "@/lib/text-safety";

/** Reasons a business can give for not paying an invoice (plan 05zn, Q3: a fixed list, with an optional note) */
export const DECLINE_REASONS = {
  duplicate: "This looks like a duplicate of another invoice",
  wrong_amount: "The amount isn't what we agreed",
  not_recognised: "We don't recognise this invoice or the work",
  wrong_details: "The invoice details need correcting",
  other: "Something else",
} as const;
export type DeclineReason = keyof typeof DECLINE_REASONS;

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_NOTE = 400;
/** Statuses a person may decline from: not yet settled, not already closed */
const DECLINABLE = new Set(["received", "verified", "held", "awaiting_approval", "scheduled", "partially_paid"]);

export function declineText(code: DeclineReason, note: string | null): string {
  // "Something else" is only a label for the note; the vendor should read the note itself
  if (code === "other") return note ?? DECLINE_REASONS[code];
  return note ? `${DECLINE_REASONS[code]}: ${note}` : DECLINE_REASONS[code];
}

/**
 * The business will not pay this invoice (plan 05zn). An offchain decision: the ledger and the Vault are untouched, the Steward
 * stops considering it, the vendor is told why, and the owner can reopen it. If the invoice is settled onchain by any route the
 * ledger's state wins on the next sync. Owner only.
 */
export async function declineInvoice(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: { fingerprint: unknown; reason: unknown; note?: unknown },
): Promise<{ ok: true; status: "declined" }> {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof body.fingerprint !== "string" || !HASH_RE.test(body.fingerprint)) throw new AuthError(400, "Malformed invoice fingerprint.");
  const fingerprint = body.fingerprint.toLowerCase();
  if (typeof body.reason !== "string" || !(body.reason in DECLINE_REASONS)) throw new AuthError(400, "Choose a reason for declining this invoice.");
  const code = body.reason as DeclineReason;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().normalize("NFC") : null;
  if (note && (note.length > MAX_NOTE || UNSAFE_TEXT.test(note))) throw new AuthError(400, `Keep the note under ${MAX_NOTE} characters, in plain text.`);
  if (code === "other" && !note) throw new AuthError(400, "Say what the reason is, so the vendor knows what to fix.");

  const [row] = await db
    .select({ status: invoices.status, seal: invoices.seal, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);
  if (!row) throw new AuthError(404, "Invoice not found.");
  if (row.status === "declined") return { ok: true, status: "declined" };
  if (!DECLINABLE.has(row.status)) throw new AuthError(409, "This invoice is already settled, cancelled or not payable, so there's nothing to decline.");

  const reason = declineText(code, note);
  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ status: "declined", declinedReason: reason, declinedAt: new Date(), holdSource: null, holdKind: null })
      .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)));
    // a vendor's offer on an invoice that won't be paid can't be accepted any more
    await tx.update(earlyPayOffers).set({ status: "withdrawn" }).where(and(eq(earlyPayOffers.fingerprint, fingerprint), eq(earlyPayOffers.status, "open")));
    await appendAppDecision(tx, businessId, {
      kind: "invoice_declined",
      subject: fingerprint,
      actor: user.id,
      inputs: { reasonCode: code, reason, invoiceNumber: row.invoiceNumber, previousStatus: row.status },
      rule: "the owner declined to pay this invoice",
      outcome: "declined",
    });
  });
  return { ok: true, status: "declined" };
}

/** The owner changes their mind: the invoice goes back to "checked" and the Steward looks at it again on its next run */
export async function reopenInvoice(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  fingerprintValue: unknown,
): Promise<{ ok: true; status: "verified" }> {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof fingerprintValue !== "string" || !HASH_RE.test(fingerprintValue)) throw new AuthError(400, "Malformed invoice fingerprint.");
  const fingerprint = fingerprintValue.toLowerCase();
  const [row] = await db
    .select({ status: invoices.status, invoiceNumber: invoices.invoiceNumber, declinedReason: invoices.declinedReason })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);
  if (!row) throw new AuthError(404, "Invoice not found.");
  if (row.status !== "declined") throw new AuthError(409, "Only a declined invoice can be reopened.");
  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ status: "verified", declinedReason: null, declinedAt: null })
      .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)));
    await appendAppDecision(tx, businessId, {
      kind: "invoice_reopened",
      subject: fingerprint,
      actor: user.id,
      inputs: { invoiceNumber: row.invoiceNumber, previousReason: row.declinedReason },
      rule: "the owner reopened a declined invoice",
      outcome: "reopened",
    });
  });
  return { ok: true, status: "verified" };
}
