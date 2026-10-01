import "server-only";

import { decisions, invoices, type Database } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { notifyBusiness, notifyVendor } from "@symbolon/core";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

/** App actions are decisions too: the record is append-only and uses the same canonical hash as Steward decisions. */
export async function appendAppDecision(
  db: Pick<Database, "insert" | "select">,
  businessId: string,
  input: {
    kind: string;
    subject?: string;
    actor: string;
    inputs: Record<string, unknown>;
    rule: string;
    outcome: string;
    txHash?: string;
  },
  txHash?: string,
): Promise<void> {
  const record: DecisionRecord = {
    version: 1,
    kind: input.kind,
    business: businessId,
    ...(input.subject ? { subject: input.subject } : {}),
    at: new Date().toISOString(),
    mode: "assist",
    inputs: { ...input.inputs, actor: input.actor },
    options: [],
    rule: input.rule,
    outcome: input.outcome,
  };
  const { hash } = hashRecord(record);
  await db.insert(decisions).values({
    businessId,
    kind: input.kind,
    subject: input.subject ?? null,
    record: record as unknown as Record<string, unknown>,
    hash,
    txHash: txHash ?? input.txHash ?? null,
  }).onConflictDoNothing();
  if (input.kind === "vendor_verification_awaiting_second" || input.kind === "vendor_invitation_awaiting_second") {
    const eventId = String(input.inputs.verificationId ?? input.inputs.invitationId ?? input.subject);
    const raiser = String(input.inputs.invitedBy ?? input.actor);
    await notifyBusiness(db, businessId, { kind: "verification_awaiting_second", subject: input.subject,
      body: { businessId }, dedupeKey: `verif:${eventId}` }, { excludeUserId: raiser });
  }
  if (["payout_change_confirmed", "payout_change_rejected", "payout_change_cancelled"].includes(input.kind) && input.subject) {
    await notifyVendor(db, input.subject, { kind: input.kind, subject: input.subject,
      body: { businessId }, dedupeKey: `${input.kind}:${String(input.inputs.requestId)}:${txHash ?? input.txHash ?? "offchain"}` });
  }
  if ((input.kind === "offer_declined" || input.kind === "counter_sent") && input.subject) {
    const [invoice] = await db.select({ seal: invoices.seal }).from(invoices).where(eq(invoices.fingerprint, input.subject));
    if (invoice) await notifyVendor(db, invoice.seal, { kind: input.kind === "counter_sent" ? "offer_countered" : "offer_declined", subject: input.subject,
      body: { businessId }, dedupeKey: input.kind === "counter_sent" ? `counter:${input.subject}` : `${input.kind}:${String(input.inputs.offerId)}` });
  }
}
