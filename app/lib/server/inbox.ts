import "server-only";

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, type Address, type Hex, type PublicClient } from "viem";
import { readVaultFacts, receiveInvoice, vaultFromPayerRef } from "@symbolon/core";
import { invoiceStatus, symbolonContracts } from "@symbolon/chain";
import { businesses, invoices, payees, seals, unsignedBills, type Database } from "@symbolon/db";
import { decodeSealedInvoice, deriveInvoice, verifySealedInvoice, type InvoiceDocument } from "@symbolon/seal";
import { findDuplicates, matchInvoice } from "@symbolon/steward";

import { requireMember, type Role } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { ChainSettings } from "./business";
import type { SessionUser } from "./session";
import { evidenceFor, type EvidenceRow } from "./match-view";

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];
const CLAIM_ROLES: Role[] = ["owner", "approver", "requester"];
const HEX_HASH = /^0x[0-9a-f]{64}$/;

export type TrustState = "verified" | "new_vendor" | "blocked" | "failed";
export type InboxFilter = "all" | "verified" | "new" | "unsigned" | "blocked";

export function duplicateCandidates(db: Database, businessId: string, seal: string, fingerprint: string) {
  return db.select({ fingerprint: invoices.fingerprint, seal: invoices.seal, invoiceNumber: invoices.invoiceNumber, total: invoices.total, issuedAt: invoices.issuedAt, receivedAt: invoices.receivedAt })
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
  const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId)).orderBy(desc(invoices.receivedAt));
  const items: InboxItem[] = [];
  for (const row of rows) {
    let trust: TrustState = "failed";
    let document: InvoiceDocument | undefined;
    try {
      ({ trust, document } = await trustFor(db, client, cfg, row));
    } catch {
      trust = "failed";
    }
    const matches = filter === "verified" ? trust === "verified" : filter === "new" ? trust === "new_vendor" : filter === "blocked" ? trust === "blocked" : filter === "unsigned" ? false : true;
    if (matches) {
      items.push({
        kind: "invoice",
        id: row.fingerprint,
        fingerprint: row.fingerprint,
        vendor: document?.vendor.name ?? "Unknown vendor",
        invoiceNumber: row.invoiceNumber,
        amount: document ? formatAmount(row.total, document.currency.decimals) : row.total.toString(),
        token: document?.currency.symbol ?? "",
        dueDate: row.dueDate,
        trust,
        status: row.status,
        createdAt: row.receivedAt,
      });
    }
  }
  if (filter === "all" || filter === "unsigned") {
    const bills = await db.select().from(unsignedBills).where(eq(unsignedBills.businessId, businessId)).orderBy(desc(unsignedBills.createdAt));
    items.push(...bills.map((bill) => {
      const assessment = bill.assessment as { verdict?: string; reasons?: string[] };
      const extraction = bill.extraction as { vendorName?: string };
      return { kind: "unsigned" as const, id: bill.id, vendor: extraction.vendorName ?? "Unsigned bill", status: bill.status, createdAt: bill.createdAt, assessment: { verdict: assessment.verdict ?? "unsigned", reasons: assessment.reasons ?? [] } };
    }));
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  return items;
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
    { fingerprint: row.fingerprint as Hex, seal: row.seal, invoiceNumber: row.invoiceNumber, amount: row.total, issuedAt: BigInt(Math.floor((row.issuedAt ?? row.receivedAt).getTime() / 1000)) },
    known.map((x) => ({ fingerprint: x.fingerprint as Hex, seal: x.seal, invoiceNumber: x.invoiceNumber, amount: x.total, issuedAt: BigInt(Math.floor((x.issuedAt ?? x.receivedAt).getTime() / 1000)) })),
  );
  const match = facts ? matchInvoice(verification.invoice, facts.payee?.terms, facts.purchaseOrder, facts.deliveryConfirmed, facts.now) : undefined;
  return { row, verification, vendor: vendor[0] ?? null, ledger, evidence: evidenceFor({ verification, invoice: verification.invoice, trust, facts, ledger, match, duplicates }), trust, facts };
}

export async function claimable(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id" | "email">, method: string, businessId: string) {
  if (method !== "circle" || !user.email) return [];
  await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES);
  const payerRef = keccak256(stringToBytes(user.email.toLowerCase()));
  return db.select().from(invoices).where(and(eq(invoices.payerRef, payerRef), isNull(invoices.businessId))).orderBy(desc(invoices.receivedAt));
}

export async function claimInvoice(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id" | "email">, method: string, businessId: string, fingerprint: string) {
  if (method !== "circle" || !user.email) throw new AuthError(403, "Only an email-verified account can claim an email-addressed invoice.");
  const business = await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES);
  if (!HEX_HASH.test(fingerprint)) throw new AuthError(400, "That invoice fingerprint is malformed.");
  const payerRef = keccak256(stringToBytes(user.email.toLowerCase()));
  const changed = await db.update(invoices).set({ businessId: business.id }).where(and(eq(invoices.fingerprint, fingerprint), eq(invoices.payerRef, payerRef), isNull(invoices.businessId))).returning({ fingerprint: invoices.fingerprint });
  if (!changed[0]) throw new AuthError(404, "That invoice is not available to claim.");
  return changed[0];
}

export async function addSealedInvoice(db: Database, client: PublicClient, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string, envelope: unknown, source: "link" | "upload") {
  const business = await businessFor(db, cfg, user, businessId, ...CLAIM_ROLES);
  const r = await receiveInvoice(db, { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger }, envelope, source, { signatureClient: client });
  if (r.status !== "verified" || !r.fingerprint) throw new AuthError(400, r.issues[0]?.message ?? "That sealed invoice didn't check out.");
  if (!business.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");
  const parsed = decodeSealedInvoice(envelope);
  const payer = vaultFromPayerRef(deriveInvoice(parsed.document).payerRef);
  if (!payer || getAddress(payer) !== getAddress(business.vault)) throw new AuthError(403, "That invoice isn't addressed to this business.");
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
