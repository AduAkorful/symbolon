import { livePurchaseOrderEvidence } from "./po-evidence";
import "server-only";

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, type Address, type Hex, type PublicClient } from "viem";
import { notifyBusiness, readVaultFacts, receiveInvoice, vaultFromPayerRef } from "@symbolon/core";
import { invoiceStatus, symbolonContracts, vaultLensAbi } from "@symbolon/chain";
import { businesses, deliveries, invoices, payees, purchaseOrders, seals, unsignedBills, type Database } from "@symbolon/db";
import { decodeSealedInvoice, deriveInvoice, verifySealedInvoice, type InvoiceDocument } from "@symbolon/seal";
import { findDuplicates, matchInvoice } from "@symbolon/steward";

import { requireMember, type Role } from "./access";
import { appendAppDecision } from "./app-decisions";
import { CHAIN_READ_DEADLINE_MS, withDeadline } from "./deadline";
import { AuthError } from "./errors";
import type { ChainSettings } from "./business";
import type { SessionUser } from "./session";
import { evidenceFor, type EvidenceRow } from "./match-view";
import { releaseDueSafe } from "./series";

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];
const CLAIM_ROLES: Role[] = ["owner", "approver", "requester"];
const HEX_HASH = /^0x[0-9a-f]{64}$/;

export type TrustState = "verified" | "new_vendor" | "blocked" | "failed";
export type InboxFilter = "all" | "verified" | "new" | "unsigned" | "blocked" | "declined" | "cancelled";

export function duplicateCandidates(db: Database, businessId: string, seal: string, fingerprint: string) {
  return db.select({ fingerprint: invoices.fingerprint, seal: invoices.seal, invoiceNumber: invoices.invoiceNumber, token: invoices.token, total: invoices.total, issuedAt: invoices.issuedAt, receivedAt: invoices.receivedAt })
    .from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal), ne(invoices.fingerprint, fingerprint)));
}

export interface InboxItem {
  kind: "invoice" | "unsigned";
  id: string;
  fingerprint?: string;
  vendor: string;
  invoiceNumber?: string;
  amount?: string;
  token?: string;
  dueDate?: Date;
  trust?: TrustState;
  status: string;
  holdSource?: string | null;
  holdKind?: string | null;
  /** True when the Vault is known not to pay this invoice's currency; undefined when that wasn't or couldn't be read */
  currencyOff?: boolean;
  createdAt: Date;
  assessment?: { verdict: string; reasons: string[] };
}

async function businessFor(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, ...roles: Role[]) {
  await requireMember(db, user.id, businessId, ...(roles.length ? roles : VIEW_ROLES));
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.chainId, cfg.chainId))).limit(1);
  if (!business) throw new AuthError(404, "That business doesn't exist.");
  return business;
}

function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

async function trustFor(db: Database, client: PublicClient, cfg: ChainSettings, row: typeof invoices.$inferSelect): Promise<{ trust: TrustState; document?: InvoiceDocument }> {
  const v = await verifySealedInvoice(row.envelope, { client, expected: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger } });
  const [payee] = await db.select({ status: payees.status }).from(payees).where(and(eq(payees.businessId, row.businessId!), eq(payees.seal, row.seal))).limit(1);
  if (!v.ok || !v.document) return { trust: "failed" };
  if (payee?.status === "blocked") return { trust: "blocked", document: v.document };
  if (payee?.status === "verified") return { trust: "verified", document: v.document };
  return { trust: "new_vendor", document: v.document };
}

/** Lists the business inbox. Trust is recomputed from the envelope and the business's payee record. */
export async function listInbox(db: Database, client: PublicClient, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, filter: InboxFilter = "all"): Promise<InboxItem[]> {
  await businessFor(db, cfg, user, businessId);
  await releaseDueSafe(db, cfg, { businessId });
  const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId)).orderBy(desc(invoices.receivedAt));
  // Each invoice is checked on its own; one after another, a long inbox would wait for the sum of every check
  const checked = await Promise.all(rows.map(async (row) => {
    let trust: TrustState = "failed";
    let document: InvoiceDocument | undefined;
    try {
      ({ trust, document } = await withDeadline(trustFor(db, client, cfg, row), CHAIN_READ_DEADLINE_MS, "Checking the invoice"));
    } catch {
      trust = "failed";
    }
    return { row, trust, document };
  }));
  // One read per currency, not per invoice. A read that fails leaves the flag unset: never a guess either way (QA UI-3)
  const [vaultRow] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const supported = new Map<string, boolean>();
  if (vaultRow?.vault) {
    const vaultAddress = getAddress(vaultRow.vault);
    await Promise.all([...new Set(rows.map((r) => r.token.toLowerCase()))].map(async (token) => {
      try {
        const ok = await withDeadline(
          client.readContract({ address: cfg.deployment.contracts.vaultLens, abi: vaultLensAbi, functionName: "isSupportedToken", args: [vaultAddress, getAddress(token)] }) as Promise<boolean>,
          CHAIN_READ_DEADLINE_MS,
          "Checking the Vault's currencies",
        );
        supported.set(token, Boolean(ok));
      } catch { /* unread stays unknown */ }
    }));
  }
  const items: InboxItem[] = checked.map(({ row, trust, document }) => ({
    kind: "invoice",
    id: row.fingerprint,
    fingerprint: row.fingerprint,
    vendor: document?.vendor.name ?? "Invoice can't be read",
    invoiceNumber: row.invoiceNumber,
    amount: document ? formatAmount(row.total, document.currency.decimals) : undefined,
    token: document?.currency.symbol ?? "",
    dueDate: row.dueDate,
    trust,
    status: row.status,
    holdSource: row.holdSource,
    holdKind: row.holdKind,
    currencyOff: supported.get(row.token.toLowerCase()) === false ? true : undefined,
    createdAt: row.receivedAt,
  }));
  const bills = await db.select().from(unsignedBills).where(eq(unsignedBills.businessId, businessId)).orderBy(desc(unsignedBills.createdAt));
  items.push(...bills.map((bill) => {
    const assessment = bill.assessment as { verdict?: string; reasons?: string[] };
    const extraction = bill.extraction as { vendorName?: string };
    return { kind: "unsigned" as const, id: bill.id, vendor: extraction.vendorName ?? "Unsigned bill", status: bill.status, createdAt: bill.createdAt, assessment: { verdict: assessment.verdict ?? "unsigned", reasons: assessment.reasons ?? [] } };
  }));
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return filterInbox(items, filter);
}

/** The filter pills: which items belong under each. Signed invoices by the vendor's trust; "unsigned" is only the unsigned bills. */
export function filterInbox(items: InboxItem[], filter: InboxFilter): InboxItem[] {
  switch (filter) {
    case "verified":
      // declined and cancelled invoices have their own chips; counting them here made the chip wrong (QA UI-17)
      return items.filter((i) => i.kind === "invoice" && i.trust === "verified" && i.status !== "declined" && i.status !== "cancelled");
    case "new":
      return items.filter((i) => i.kind === "invoice" && i.trust === "new_vendor");
    case "blocked":
      return items.filter((i) => i.kind === "invoice" && i.trust === "blocked");
    case "unsigned":
      return items.filter((i) => i.kind === "unsigned");
    case "declined":
      return items.filter((i) => i.kind === "invoice" && i.status === "declined");
    case "cancelled":
      return items.filter((i) => i.kind === "invoice" && i.status === "cancelled");
    default:
      return items;
  }
}

export async function loadInvoiceDetail(db: Database, client: PublicClient, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, fingerprint: string) {
  if (!HEX_HASH.test(fingerprint)) return null;
  const business = await businessFor(db, cfg, user, businessId);
  const [row] = await db.select().from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint))).limit(1);
  if (!row) return null;
  const verification = await verifySealedInvoice(row.envelope, { client, expected: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger } });
  const vendor = await db.select({ displayName: seals.displayName, legalName: seals.legalName, handle: seals.handle }).from(seals).where(eq(seals.address, row.seal)).limit(1);
  if (!verification.invoice || !verification.document) return { row, verification, vendor: vendor[0] ?? null, evidence: evidenceFor({ verification, invoice: verification.invoice!, trust: "failed" }), ledger: undefined };

  let ledger;
  let facts;
  try {
    const contracts = symbolonContracts(client, cfg.deployment);
    ledger = await invoiceStatus(contracts, row.fingerprint as Hex);
    if (business.vault) facts = await readVaultFacts(contracts, client, getAddress(business.vault), verification.invoice, row.fingerprint as Hex);
  } catch {
    // The evidence builder turns missing chain facts into a blocking row.
  }
  const [payee] = await db.select({ status: payees.status }).from(payees).where(and(eq(payees.businessId, businessId), eq(payees.seal, row.seal))).limit(1);
  const trust: TrustState = payee?.status === "blocked" ? "blocked" : payee?.status === "verified" ? "verified" : "new_vendor";
  const known = await duplicateCandidates(db, businessId, row.seal, row.fingerprint);
  const duplicates = findDuplicates(
    { fingerprint: row.fingerprint as Hex, seal: row.seal, invoiceNumber: row.invoiceNumber, amount: row.total, token: row.token, issuedAt: BigInt(Math.floor((row.issuedAt ?? row.receivedAt).getTime() / 1000)) },
    known.map((x) => ({ fingerprint: x.fingerprint as Hex, seal: x.seal, invoiceNumber: x.invoiceNumber, amount: x.total, token: x.token, issuedAt: BigInt(Math.floor((x.issuedAt ?? x.receivedAt).getTime() / 1000)) })),
  );
  const match = facts ? matchInvoice(verification.invoice, facts.payee?.terms, facts.purchaseOrder, facts.deliveryConfirmed, facts.now) : undefined;

  // N11: load DB delivery and PO rows to enrich evidence
  const [dbDelivery] = await db
    .select({ state: deliveries.state, reason: deliveries.reason, txHash: deliveries.txHash })
    .from(deliveries)
    .where(and(eq(deliveries.businessId, businessId), eq(deliveries.fingerprint, fingerprint)))
    .limit(1);
  let dbPo: import("./match-view").MatchViewInput["dbPo"] | undefined;
  if (verification.invoice.poRef && verification.invoice.poRef !== `0x${"00".repeat(32)}`) {
    const [poRow] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.poRef, verification.invoice.poRef)))
      .limit(1);
    if (poRow) {
      dbPo = business.vault
        ? await livePurchaseOrderEvidence(symbolonContracts(client, cfg.deployment), business.vault, verification.invoice.poRef as Hex, poRow)
        : { poNumber: poRow.poNumber, open: false, remainingRaw: null, releaseAfter: poRow.releaseAfter ?? null, openTx: poRow.openTx ?? null, closedAt: poRow.closedAt ?? null };
    }
  }

  return { row, verification, vendor: vendor[0] ?? null, ledger, evidence: evidenceFor({ verification, invoice: verification.invoice, trust, facts, ledger, match, duplicates, dbDelivery: dbDelivery ?? undefined, dbPo }), trust, facts, holdSource: row.holdSource };
}


export async function claimable(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id" | "email">, businessId: string) {
  // users.email is only ever copied from an email Privy has verified (plan 05k, P3), so having one is the proof
  if (!user.email) return [];
  // A viewer has nothing to claim, and that is not an error for the inbox that asked
  try { await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES); } catch (e) { if (e instanceof AuthError && e.status === 403) return []; throw e; }
  const payerRef = keccak256(stringToBytes(user.email.toLowerCase()));
  return db.select().from(invoices).where(and(eq(invoices.payerRef, payerRef), isNull(invoices.businessId))).orderBy(desc(invoices.receivedAt));
}

export async function claimInvoice(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id" | "email">, businessId: string, fingerprint: string) {
  if (!user.email) throw new AuthError(403, "Only an email-verified account can claim an email-addressed invoice.");
  const business = await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES);
  if (!HEX_HASH.test(fingerprint)) throw new AuthError(400, "That invoice fingerprint is malformed.");
  const payerRef = keccak256(stringToBytes(user.email.toLowerCase()));
  const changed = await db.update(invoices).set({ businessId: business.id }).where(and(eq(invoices.fingerprint, fingerprint), eq(invoices.payerRef, payerRef), isNull(invoices.businessId))).returning({ fingerprint: invoices.fingerprint });
  if (!changed[0]) throw new AuthError(404, "That invoice is not available to claim.");
  // The rest of the team hears an invoice arrived; the person who claimed it knows (plan 05zj E, D11 a)
  const [row] = await db.select({ envelope: invoices.envelope }).from(invoices).where(eq(invoices.fingerprint, fingerprint)).limit(1);
  try {
    const doc = decodeSealedInvoice(row!.envelope).document;
    await notifyBusiness(db, business.id, {
      kind: "invoice_received",
      subject: fingerprint,
      body: { invoiceNumber: doc.invoiceNumber, vendorName: doc.vendor.name },
      dedupeKey: `invoice:${fingerprint}`,
    }, { excludeUserId: user.id });
  } catch (e) {
    console.error("claim: couldn't notify the team", e instanceof Error ? e.message : e);
  }
  return changed[0];
}

export async function addSealedInvoice(db: Database, client: PublicClient, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, envelope: unknown, source: "link" | "upload") {
  const business = await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES);
  if (!business.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");
  // Addressing is checked before anything is stored: an invoice for another payer is refused, not filed (plan 05j, B5)
  let payer: Address | undefined;
  try { payer = vaultFromPayerRef(deriveInvoice(decodeSealedInvoice(envelope).document).payerRef); } catch { throw new AuthError(400, "That isn't a sealed invoice."); }
  if (!payer || getAddress(payer) !== getAddress(business.vault)) throw new AuthError(403, "That invoice isn't addressed to this business.");
  const r = await receiveInvoice(db, { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger }, envelope, source, { signatureClient: client, excludeUserId: user.id });
  if (r.status !== "verified" || !r.fingerprint) throw new AuthError(400, r.issues[0]?.message ?? "That sealed invoice didn't check out.");
  await db.update(invoices).set({ businessId: business.id }).where(and(eq(invoices.fingerprint, r.fingerprint), isNull(invoices.businessId)));
  return { fingerprint: r.fingerprint };
}

export async function blockSeal(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, seal: string, blocked: boolean) {
  if (blocked) await businessFor(db, cfg, user, businessId, "owner", "approver");
  else await businessFor(db, cfg, user, businessId, "owner");
  let address: Address;
  try { address = getAddress(seal).toLowerCase() as Address; } catch { throw new AuthError(400, "That Seal address is malformed."); }
  await db.insert(payees).values({ businessId, seal: address, status: blocked ? "blocked" : "pending_verification" }).onConflictDoUpdate({ target: [payees.businessId, payees.seal], set: { status: blocked ? "blocked" : "pending_verification" } });
  await appendAppDecision(db, businessId, { kind: blocked ? "block_seal" : "unblock_seal", subject: address, actor: user.id, inputs: { seal: address }, rule: blocked ? "business blocked this Seal" : "business unblocked this Seal", outcome: blocked ? "blocked" : "unblocked" });
  return { seal: address, status: blocked ? "blocked" : "pending_verification" };
}
