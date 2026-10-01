import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";

import { symbolonContracts } from "@symbolon/chain";
import { recordOffer, expireOffers, counterOffer, counterRecommendation, createInvoiceInputReader, readVaultFacts } from "@symbolon/core";
import { businesses, decisions, earlyPayOffers, invoices, type Database } from "@symbolon/db";
import { applyDiscount, MAX_DISCOUNT_BPS, sealDomain, typedDataJson } from "@symbolon/seal";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { AppConfig } from "./load-config";
import type { SessionUser } from "./session";
import { requireMySeal } from "./vendor";
import { buildStewardEnv } from "./steward-runtime";
import { verifyPaymentDocument, readPaymentLedger } from "./payment-ledger";
import { processInvoice, type InvoiceContext } from "@symbolon/steward";

export interface OfferDisplay {
  id: string;
  fingerprint: string;
  discountBps: number;
  discountPercent: string;
  validUntil: string;
  validUntilEpoch: number;
  status: "open" | "countered" | "declined" | "expired" | "taken" | "withdrawn";
  isCounter: boolean;
  signature: string | null;
  createdAt: string;
}

/**
 * Prepares the typed data for a vendor to sign an EarlyPayOffer (Plan 05q, Decision V1-V2).
 */
export async function prepareOffer(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  fingerprintValue: unknown,
  discountBpsValue: unknown,
  durationSecondsValue: unknown,
  counterId?: unknown,
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof fingerprintValue !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fingerprintValue)) {
    throw new AuthError(400, "That isn't a valid invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.fingerprint, fingerprint))
    .limit(1);

  if (!inv) {
    throw new AuthError(404, "Invoice not found.");
  }
  if (inv.seal.toLowerCase() !== seal.address.toLowerCase()) {
    throw new AuthError(403, "You can only make Early Pay offers on your own invoices.");
  }

  // Check ledger onchain state
  const contracts = symbolonContracts(client, cfg.deployment);

  let state;
  try {
    state = await contracts.ledger.read.status([fingerprint]);
  } catch (err) {
    throw new AuthError(502, "Unable to check invoice status on the ledger right now.");
  }

  if (state.cancelled) {
    throw new AuthError(400, "This invoice has been cancelled on the ledger.");
  }
  if (state.credited >= BigInt(inv.total)) {
    throw new AuthError(400, "This invoice is already fully paid.");
  }

  const discountBps = Number(discountBpsValue);
  if (!Number.isInteger(discountBps) || discountBps < 1 || discountBps > MAX_DISCOUNT_BPS) {
    throw new AuthError(400, `Discount must be an integer between 1 and ${MAX_DISCOUNT_BPS} bps (up to 50%).`);
  }

  const durationSeconds = Number(durationSecondsValue);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 60 || durationSeconds > 30 * 86400) {
    throw new AuthError(400, "Duration must be between 1 minute and 30 days.");
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  let validUntil = BigInt(nowEpoch + durationSeconds);
  if (typeof counterId === "string") {
    const [counter] = await db.select().from(earlyPayOffers).where(and(eq(earlyPayOffers.id, counterId), eq(earlyPayOffers.fingerprint, fingerprint), eq(earlyPayOffers.status, "countered")));
    if (!counter || counter.discountBps !== discountBps || counter.validUntil.getTime() <= Date.now()) throw new AuthError(409, "That counter is no longer available.");
    validUntil = BigInt(Math.floor(counter.validUntil.getTime() / 1000));
  }
  const dueEpoch = Math.floor(new Date(inv.dueDate).getTime() / 1000);

  if (validUntil > BigInt(dueEpoch)) {
    throw new AuthError(400, "Offer validity cannot extend past the invoice's due date.");
  }

  // Check for duplicate open offer with exact same discount and validUntil
  const existing = await db
    .select()
    .from(earlyPayOffers)
    .where(
      and(
        eq(earlyPayOffers.fingerprint, fingerprint),
        eq(earlyPayOffers.status, "open"),
        eq(earlyPayOffers.discountBps, discountBps),
      ),
    );

  if (existing.length > 0) {
    throw new AuthError(409, "An open offer with this discount already exists for this invoice.");
  }

  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const typedData = typedDataJson(domain, "EarlyPayOffer", {
    fingerprint,
    discountBps,
    validUntil,
  });

  const remaining = BigInt(inv.total) - state.credited;
  const paid = applyDiscount(remaining, discountBps);
  const saving = remaining - paid;

  return {
    typedData,
    fingerprint,
    discountBps,
    validUntil: Number(validUntil),
    remaining: remaining.toString(),
    paid: paid.toString(),
    saving: saving.toString(),
  };
}

/**
 * Submits the vendor-signed EarlyPayOffer to the database.
 */
export async function submitOffer(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    fingerprint: unknown;
    discountBps: unknown;
    validUntil: unknown;
    signature: unknown;
    counterId?: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof input.fingerprint !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.fingerprint)) {
    throw new AuthError(400, "Invalid fingerprint.");
  }
  const fingerprint = input.fingerprint.toLowerCase() as Hex;

  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature)) {
    throw new AuthError(400, "Invalid signature.");
  }
  const signature = input.signature.toLowerCase() as Hex;

  const discountBps = Number(input.discountBps);
  const validUntil = BigInt(Number(input.validUntil));

  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.fingerprint, fingerprint))
    .limit(1);

  if (!inv) {
    throw new AuthError(404, "Invoice not found.");
  }
  if (inv.seal.toLowerCase() !== seal.address.toLowerCase()) {
    throw new AuthError(403, "You can only submit offers for your own invoices.");
  }

  // Check if an open offer already exists for this invoice
  const [active] = await db
    .select({ id: earlyPayOffers.id })
    .from(earlyPayOffers)
    .where(
      and(
        eq(earlyPayOffers.fingerprint, fingerprint),
        eq(earlyPayOffers.status, "open"),
      ),
    )
    .limit(1);

  let acceptedCounter: typeof earlyPayOffers.$inferSelect | undefined;
  if (typeof input.counterId === "string") {
    [acceptedCounter] = await db.select().from(earlyPayOffers).where(and(eq(earlyPayOffers.id, input.counterId), eq(earlyPayOffers.fingerprint, fingerprint), eq(earlyPayOffers.status, "countered")));
    if (!acceptedCounter || acceptedCounter.discountBps !== discountBps || BigInt(Math.floor(acceptedCounter.validUntil.getTime() / 1000)) !== validUntil || acceptedCounter.validUntil.getTime() <= Date.now()) throw new AuthError(409, "Counter terms changed or expired.");
  }
  if (active && !acceptedCounter) {
    throw new AuthError(400, "An active early pay offer already exists for this invoice.");
  }

  try {
    const res = await db.transaction(async (tx) => {
      const res = await recordOffer(
      tx as unknown as Database,
      { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
      {
        fingerprint,
        discountBps,
        validUntil,
        signature,
      },
      { client: client as any },
    );
      if (acceptedCounter) {
        await tx.update(earlyPayOffers).set({ status: "withdrawn" }).where(and(eq(earlyPayOffers.fingerprint, fingerprint), eq(earlyPayOffers.status, "open"), lt(earlyPayOffers.discountBps, discountBps)));
        await tx.update(earlyPayOffers).set({ status: "declined" }).where(eq(earlyPayOffers.id, acceptedCounter.id));
      }
      return res;
    });
    return { id: res.id };
  } catch (err) {
    throw new AuthError(400, err instanceof Error ? err.message : "Failed to record offer.");
  }
}

/**
 * Withdraws an open offer (vendor action, offchain).
 */
export async function withdrawOffer(
  db: Database,
  user: Pick<SessionUser, "id">,
  offerId: string,
) {
  const seal = await requireMySeal(db, user.id);

  const [offer] = await db
    .select({
      id: earlyPayOffers.id,
      status: earlyPayOffers.status,
      fingerprint: earlyPayOffers.fingerprint,
      seal: invoices.seal,
    })
    .from(earlyPayOffers)
    .innerJoin(invoices, eq(invoices.fingerprint, earlyPayOffers.fingerprint))
    .where(eq(earlyPayOffers.id, offerId))
    .limit(1);

  if (!offer) {
    throw new AuthError(404, "Offer not found.");
  }
  if (offer.seal.toLowerCase() !== seal.address.toLowerCase()) {
    throw new AuthError(403, "You can only withdraw your own offers.");
  }
  if (offer.status !== "open") {
    throw new AuthError(400, "Only open offers can be withdrawn.");
  }

  await db
    .update(earlyPayOffers)
    .set({ status: "withdrawn" })
    .where(eq(earlyPayOffers.id, offerId));

  return { success: true, withdrawn: true };
}

/**
 * Declines an open offer (business owner/approver action).
 */
export async function declineOffer(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  offerId: string,
  reason?: string,
) {
  await requireMember(db, user.id, businessId, "owner", "approver");
  await expireOffers(db, new Date());

  const [offer] = await db
    .select({
      id: earlyPayOffers.id,
      status: earlyPayOffers.status,
      discountBps: earlyPayOffers.discountBps,
      fingerprint: earlyPayOffers.fingerprint,
      businessId: invoices.businessId,
    })
    .from(earlyPayOffers)
    .innerJoin(invoices, eq(invoices.fingerprint, earlyPayOffers.fingerprint))
    .where(eq(earlyPayOffers.id, offerId))
    .limit(1);

  if (!offer) {
    throw new AuthError(404, "Offer not found.");
  }
  if (offer.businessId !== businessId) {
    throw new AuthError(403, "Offer does not belong to this business.");
  }
  if (offer.status !== "open") {
    throw new AuthError(400, "Offer is no longer open.");
  }

  await db
    .update(earlyPayOffers)
    .set({ status: "declined" })
    .where(eq(earlyPayOffers.id, offerId));

  await appendAppDecision(db, businessId, {
    kind: "offer_declined",
    subject: offer.fingerprint,
    actor: user.id,
    inputs: { offerId, discountBps: offer.discountBps, ...(reason ? { reason } : {}) },
    rule: "human_review",
    outcome: "declined",
  });

  return { success: true, declined: true };
}

export async function businessOffers(db: Database, user: Pick<SessionUser, "id">, businessId: string, fingerprint: string) {
  const member = await requireMember(db, user.id, businessId);
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint.toLowerCase())));
  if (!invoice) throw new AuthError(404, "Invoice not found.");
  const offers = await listOffersForInvoice(db, invoice.fingerprint);
  const [recommendation] = await db.select().from(decisions).where(and(eq(decisions.businessId, businessId), eq(decisions.subject, invoice.fingerprint), eq(decisions.kind, "counter_recommended"))).orderBy(desc(decisions.createdAt)).limit(1);
  const inputs = recommendation?.record.inputs as { discountBps?: number; validUntil?: string } | undefined;
  const counter = inputs?.discountBps && inputs.validUntil && BigInt(inputs.validUntil) > BigInt(Math.floor(Date.now() / 1000)) && !offers.some((o) => o.isCounter)
    ? { discountBps: inputs.discountBps, validUntil: inputs.validUntil } : null;
  return { offers, counter, canAct: member.role === "owner" || member.role === "approver", remaining: (invoice.total - invoice.credited).toString() };
}

/** A person sends only a counter recomputed from current signed offers and live business controls. */
export async function sendCounter(db: Database, client: PublicClient, cfg: AppConfig, user: Pick<SessionUser, "id">, businessId: string, fingerprint: string) {
  await requireMember(db, user.id, businessId, "owner", "approver");
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.chainId, cfg.chainId)));
  const [row] = await db.select().from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint.toLowerCase())));
  if (!business?.vault || !row) throw new AuthError(404, "Invoice not found.");
  if (row.holdSource === "human") throw new AuthError(409, "A human hold must be released before countering.");
  const vault = getAddress(business.vault);
  const contracts = symbolonContracts(client, cfg.deployment);
  const verified = await verifyPaymentDocument(client, cfg, row.envelope, row.fingerprint as Hex);
  const ledger = await readPaymentLedger(contracts, row.fingerprint as Hex, verified.invoice.amount);
  if (ledger.cancelled || ledger.settled) throw new AuthError(409, "Invoice is settled or cancelled.");
  const facts = await readVaultFacts(contracts, client, vault, verified.invoice, row.fingerprint as Hex);
  const env = await buildStewardEnv(db, client, cfg, business);
  const reader = await createInvoiceInputReader(env, businessId, vault);
  const context: InvoiceContext = { business: { id: businessId, vault, mode: "assist", program: env.program },
    deployment: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger }, envelope: row.envelope,
    facts, ledgerRemaining: ledger.ledgerRemaining, ...(await reader.forInvoice(row, facts.now)), reserveYieldBps: env.reserveYieldBps, approvalHeld: 0, signatureClient: client };
  const result = await processInvoice(context, { simulate: async () => { throw new Error("Counter cannot submit a payment"); } });
  const counter = counterRecommendation(context, result);
  if (!counter) throw new AuthError(409, "No counter clears the current owner's limits.");
  const created = await counterOffer(db, { fingerprint: row.fingerprint as Hex, discountBps: counter.discountBps, validUntil: new Date(Number(counter.validUntil) * 1000) });
  await appendAppDecision(db, businessId, { kind: "counter_sent", subject: row.fingerprint, actor: user.id,
    inputs: { counterId: created.id, discountBps: counter.discountBps, validUntil: counter.validUntil.toString() }, rule: "human sent one unsigned counter within the owner's limits", outcome: "countered" });
  return created;
}

/**
 * Lists all offers for an invoice with derived statuses.
 */
export async function listOffersForInvoice(
  db: Database,
  fingerprintValue: unknown,
): Promise<OfferDisplay[]> {
  if (typeof fingerprintValue !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fingerprintValue)) {
    throw new AuthError(400, "Invalid fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase();

  // Expire outdated offers
  await expireOffers(db, new Date());

  const rows = await db
    .select()
    .from(earlyPayOffers)
    .where(eq(earlyPayOffers.fingerprint, fingerprint))
    .orderBy(desc(earlyPayOffers.createdAt));

  const now = new Date();

  return rows.map((r) => {
    let derivedStatus = r.status as OfferDisplay["status"];
    if (derivedStatus === "open" && r.validUntil < now) {
      derivedStatus = "expired";
    }
    return {
      id: r.id,
      fingerprint: r.fingerprint,
      discountBps: r.discountBps,
      discountPercent: (r.discountBps / 100).toFixed(2),
      validUntil: r.validUntil.toISOString(),
      validUntilEpoch: Math.floor(r.validUntil.getTime() / 1000),
      status: derivedStatus,
      isCounter: r.status === "countered" || r.signature === null,
      signature: r.signature,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Returns the suggested discount for a vendor based on past accepted/settled offers.
 * If no past history exists, returns null (spec claims discipline).
 */
export async function suggestedDiscount(
  db: Database,
  sealAddress: string,
): Promise<{ discountBps: number; discountPercent: string } | null> {
  // Query past offers that were taken / settled on invoices belonging to this seal
  const rows = await db
    .select({ discountBps: earlyPayOffers.discountBps })
    .from(earlyPayOffers)
    .innerJoin(invoices, eq(invoices.fingerprint, earlyPayOffers.fingerprint))
    .where(
      and(
        eq(invoices.seal, sealAddress.toLowerCase()),
        eq(invoices.status, "paid"),
      ),
    )
    .limit(1);

  if (rows.length === 0 || !rows[0]) return null;
  const discountBps = rows[0].discountBps;
  return {
    discountBps,
    discountPercent: (discountBps / 100).toFixed(2),
  };
}
