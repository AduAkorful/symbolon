import "server-only";

import { businesses, decisions, invoices, users, type Database } from "@symbolon/db";
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
  await notifyForDecision(db, businessId, input, txHash ?? input.txHash, hash);
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
  if (input.kind === "invoice_declined" && input.subject) {
    const [invoice] = await db.select({ seal: invoices.seal, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(eq(invoices.fingerprint, input.subject));
    const [biz] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (invoice) await notifyVendor(db, invoice.seal, { kind: "invoice_declined", subject: input.subject,
      body: { businessName: biz?.name ?? null, invoiceNumber: invoice.invoiceNumber, reason: input.inputs.reason ?? null }, dedupeKey: `declined:${input.subject}:${hash}` });
  }
  // the owners are told when a rule change is waiting and when an upgrade landed, including the person who did it (QA REL4-6)
  if (input.kind === "change_queued" || input.kind === "upgrade_applied") {
    const summary = (input.inputs.summary as { title?: unknown } | undefined) ?? {};
    await notifyBusiness(db, businessId, {
      kind: input.kind,
      subject: input.subject ?? null,
      body: input.kind === "change_queued"
        ? { title: typeof summary.title === "string" ? summary.title : null, eta: input.inputs.eta ?? null }
        : { stateMatch: input.outcome === "applied" },
      dedupeKey: `${input.kind}:${hash}`,
    }, { roles: ["owner"] });
  }
  if (input.kind === "invoice_reopened" && input.subject) {
    const [invoice] = await db.select({ seal: invoices.seal, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(eq(invoices.fingerprint, input.subject));
    const [biz] = await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (invoice) await notifyVendor(db, invoice.seal, { kind: "invoice_reopened", subject: input.subject,
      body: { businessName: biz?.name ?? null, invoiceNumber: invoice.invoiceNumber }, dedupeKey: `reopened:${input.subject}:${hash}` });
  }
  if ((input.kind === "offer_declined" || input.kind === "counter_sent") && input.subject) {
    const [invoice] = await db.select({ seal: invoices.seal }).from(invoices).where(eq(invoices.fingerprint, input.subject));
    if (invoice) await notifyVendor(db, invoice.seal, { kind: input.kind === "counter_sent" ? "offer_countered" : "offer_declined", subject: input.subject,
      body: { businessId }, dedupeKey: input.kind === "counter_sent" ? `counter:${input.subject}` : `${input.kind}:${String(input.inputs.offerId)}` });
  }
}

/** What a money-moving action by a person is called in the notice sent to the rest of the team */
// a payment is announced from the ledger's own Settled event (all routes, the Steward included), not from here
const MONEY_ACTIONS = new Set(["withdrawn", "deposit_confirmed", "steward_fees_funded", "eurc_conversion"]);
const VENDOR_VERIFIED_KINDS = new Set(["vendor_verified_invitation", "vendor_verified_code", "vendor_verification_second_confirmed"]);

/**
 * The bell's producers that hang off a recorded action (plan 05zj E, D11 a). Recipients are always resolved here from current
 * members and the Seal's own user, never from the caller, and the person who did the thing is never told about their own action.
 *  - the team hears when another member moved money;
 *  - the vendor hears when a code was requested for them, when they were verified, and when they were added as a payee.
 * Each notice has a dedupe key, so recording the same action twice rings once.
 */
async function notifyForDecision(
  db: Pick<Database, "insert" | "select">,
  businessId: string,
  input: { kind: string; subject?: string; actor: string; inputs: Record<string, unknown> },
  txHash: string | undefined,
  decisionHash: string,
): Promise<void> {
  const needsBusiness = input.subject && (input.kind === "vendor_code_requested" || input.kind === "payee_added" || VENDOR_VERIFIED_KINDS.has(input.kind));
  const [biz] = needsBusiness ? await db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1) : [];

  if (input.kind === "vendor_code_requested" && input.subject) {
    await notifyVendor(db, input.subject, {
      kind: "verification_requested", subject: input.subject, body: { businessId, businessName: biz?.name ?? null },
      dedupeKey: `code:${String(input.inputs.verificationId ?? decisionHash)}`,
    });
  }
  if (VENDOR_VERIFIED_KINDS.has(input.kind) && input.subject) {
    await notifyVendor(db, input.subject, {
      kind: "verified_by_business", subject: input.subject, body: { businessId, businessName: biz?.name ?? null },
      dedupeKey: `verified:${businessId}:${input.subject.toLowerCase()}`,
    });
  }
  if (input.kind === "payee_added" && input.subject) {
    await notifyVendor(db, input.subject, {
      kind: "added_as_payee", subject: input.subject,
      body: { businessId, businessName: biz?.name ?? null, activeAt: input.inputs.activeAt ?? null },
      dedupeKey: `payee:${businessId}:${txHash ?? decisionHash}`,
    });
  }

  // money moved by a person: the rest of the team is told (owners and approvers), never the person themselves
  if (MONEY_ACTIONS.has(input.kind) && input.actor) {
    const [who] = await db.select({ email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, input.actor)).limit(1);
    await notifyBusiness(
      db,
      businessId,
      {
        kind: "money_moved",
        subject: input.subject ?? null,
        body: { action: input.kind, by: who?.displayName ?? who?.email ?? "A team member", amount: input.inputs.amount ?? input.inputs.paid ?? null, token: input.inputs.token ?? null },
        dedupeKey: `money:${txHash ?? decisionHash}`,
      },
      { excludeUserId: input.actor },
    );
  }
}
