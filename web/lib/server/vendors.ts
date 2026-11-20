import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getAddress, type Address, type PublicClient } from "viem";
import { symbolonContracts } from "@symbolon/chain";
import { businesses, invoices, payees, seals, users, vendorInvitations, vendorVerifications, type Database } from "@symbolon/db";
import type { Deployment } from "@symbolon/chain";
import { requireMember } from "./access";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

export async function listVendors(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, businessId: string, onlySeal?: string) {
  await requireMember(db, user.id, businessId);
  const sealFilter = onlySeal?.toLowerCase();
  const [business, rows, invoiceSeals] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1),
    db.select({ payee: payees, vendor: seals }).from(payees).leftJoin(seals, eq(seals.address, payees.seal)).where(and(eq(payees.businessId, businessId), sealFilter ? eq(payees.seal, sealFilter) : undefined)).orderBy(desc(payees.createdAt)),
    db.selectDistinct({ seal: invoices.seal }).from(invoices).where(and(eq(invoices.businessId, businessId), sealFilter ? eq(invoices.seal, sealFilter) : undefined)),
  ]);
  const biz = business[0];
  if (!biz) throw new AuthError(404, "That business doesn't exist.");
  const known = new Set(rows.map(({ payee }) => payee.seal));
  const missingSeals = invoiceSeals.filter((x) => !known.has(x.seal)).map((x) => x.seal);
  const missingNames = missingSeals.length ? await db.select().from(seals).where(inArray(seals.address, missingSeals)) : [];
  const nameBySeal = new Map(missingNames.map((vendor) => [vendor.address.toLowerCase(), vendor]));
  const missing = missingSeals.map((seal) => ({ payee: { businessId, seal, status: "pending_verification" as const, verificationMethod: null, verifiedBy: null, verifiedAt: null, createdAt: new Date() }, vendor: nameBySeal.get(seal.toLowerCase()) ?? null }));
  const combined = [...rows, ...missing];
  const sealList = combined.map(({ payee }) => payee.seal);
  const haveInvoice = new Set(invoiceSeals.map((x) => x.seal));
  const [verificationRows, invitations, blockNumber] = await Promise.all([
    sealList.length ? db.select().from(vendorVerifications).where(and(eq(vendorVerifications.businessId, businessId), inArray(vendorVerifications.seal, sealList))).orderBy(desc(vendorVerifications.createdAt)) : Promise.resolve([]),
    db.select().from(vendorInvitations).where(and(eq(vendorInvitations.businessId, businessId), isNull(vendorInvitations.revokedAt))).orderBy(desc(vendorInvitations.createdAt)),
    biz.vault ? client.getBlockNumber().catch(() => null) : Promise.resolve(null),
  ]);
  const latestVerification = new Map<string, (typeof verificationRows)[number]>();
  for (const row of verificationRows) {
    if (!row.seal) continue;
    const key = row.seal.toLowerCase();
    if (!latestVerification.has(key)) latestVerification.set(key, row);
  }
  const contracts = biz.vault && blockNumber !== null ? symbolonContracts(client, deployment) : null;
  const vendors = await Promise.all(combined.map(async ({ payee, vendor }) => {
    const verification = latestVerification.get(payee.seal.toLowerCase()) ?? null;
    let canBePaid: { confirmed: true; exists: boolean; activeAt: string; payout: string; payoutDomain: number; paidCount: number; terms: { budget: string; monthlyCap: string; requirePo: boolean; requireDelivery: boolean }; screening: { risk: string; at: string } } | { confirmed: false } = { confirmed: false };
    if (biz.vault && blockNumber !== null && contracts) {
      try {
        const p = await contracts.lens.read.getPayee([getAddress(biz.vault) as Address, getAddress(payee.seal) as Address], { blockNumber });
        const risks = ["Low", "Medium", "High", "Blocked"];
        canBePaid = { confirmed: true, exists: p.exists, activeAt: p.activeAt.toString(), payout: p.payout, payoutDomain: p.payoutDomain, paidCount: p.paidCount, terms: { budget: p.terms.budget, monthlyCap: p.terms.monthlyCap.toString(), requirePo: p.terms.requirePo, requireDelivery: p.terms.requireDelivery }, screening: { risk: p.screenedAt === 0n ? "Not screened" : risks[p.risk] ?? "Unknown", at: p.screenedAt.toString() } };
      } catch { /* Unknown chain state stays unknown; never infer from the offchain row. */ }
    }
    return { seal: payee.seal, name: vendor?.displayName ?? payee.seal, handle: vendor?.handle ?? null, status: payee.status, verification: verification ? { id: verification.id, method: verification.method, status: verification.status, contacted: verification.contacted, channel: verification.channel, raisedBy: verification.raisedBy, confirmedBy: verification.confirmedBy, secondBy: verification.secondBy, at: verification.updatedAt } : null, invoiceOnFile: haveInvoice.has(payee.seal), canBePaid, blockNumber: blockNumber?.toString() ?? null };
  }));
  return { vendors, invitations: invitations.filter((i) => !i.acceptedAt && i.expiresAt > new Date()).map((i) => ({ id: i.id, vendorName: i.vendorName, contactNote: i.contactNote, terms: i.terms, expiresAt: i.expiresAt })) };
}

/** Business-scoped vendor facts and verification history for the vendor master detail page. */
export async function vendorDetail(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, businessId: string, sealValue: string) {
  const membership = await requireMember(db, user.id, businessId);
  let seal: string;
  try { seal = getAddress(sealValue).toLowerCase(); } catch { throw new AuthError(404, "That vendor isn't linked to this business."); }
  const [businessRows, listed, history, invoicesOnFile] = await Promise.all([
    db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1),
    listVendors(db, client, deployment, user, businessId, seal),
    db.select().from(vendorVerifications).where(and(eq(vendorVerifications.businessId, businessId), eq(vendorVerifications.seal, seal))).orderBy(desc(vendorVerifications.createdAt)),
    db.select({
    fingerprint: invoices.fingerprint,
    invoiceNumber: invoices.invoiceNumber,
    total: invoices.total,
    token: invoices.token,
    dueDate: invoices.dueDate,
  }).from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal))).orderBy(desc(invoices.receivedAt)),
  ]);
  const business = businessRows[0];
  if (!business) throw new AuthError(404, "That vendor isn't linked to this business.");
  const vendor = listed.vendors.find((row) => row.seal.toLowerCase() === seal);
  if (!vendor) throw new AuthError(404, "That vendor isn't linked to this business.");
  const actorIds = [...new Set(history.flatMap((row) => [row.raisedBy, row.confirmedBy, row.secondBy].filter((id): id is string => Boolean(id))))];
  const actors = actorIds.length
    ? await db.select({ id: users.id, email: users.email, wallet: users.wallet }).from(users).where(inArray(users.id, actorIds))
    : [];
  const actorLabels = new Map(actors.map((actor) => [actor.id, actor.email ?? actor.wallet ?? ("Member " + actor.id.slice(0, 8))]));

  return {
    ...vendor,
    businessName: business.name,
    memberRole: membership.role,
    verificationHistory: history.map((row) => ({
      id: row.id,
      method: row.method,
      status: row.status,
      contacted: row.contacted,
      channel: row.channel,
      raisedBy: actorLabels.get(row.raisedBy) ?? "Member",
      confirmedBy: row.confirmedBy ? actorLabels.get(row.confirmedBy) ?? "Member" : null,
      secondBy: row.secondBy ? actorLabels.get(row.secondBy) ?? "Member" : null,
      at: row.updatedAt,
    })),
    invoices: invoicesOnFile.map((row) => ({
      fingerprint: row.fingerprint,
      invoiceNumber: row.invoiceNumber,
      total: row.total.toString(),
      // a euro invoice is shown in euros, not dollars (QA UI-1)
      symbol: row.token.toLowerCase() === deployment.tokens.eurc?.toLowerCase() ? "EURC" : "USDC",
      dueDate: row.dueDate,
    })),
  };
}

/**
 * The vendors this business already deals with, by the name people use: its payees and the vendors that have sent it an
 * invoice. Names only, no chain reads, so a form can offer them without waiting. A vendor with no name on file shows its address.
 */
export async function listKnownVendors(db: Database, businessId: string): Promise<{ seal: string; name: string }[]> {
  const [fromPayees, fromInvoices] = await Promise.all([
    db.select({ seal: payees.seal }).from(payees).where(eq(payees.businessId, businessId)),
    db.selectDistinct({ seal: invoices.seal }).from(invoices).where(eq(invoices.businessId, businessId)),
  ]);
  const sealAddresses = [...new Set([...fromPayees, ...fromInvoices].map((r) => r.seal.toLowerCase()))];
  if (sealAddresses.length === 0) return [];
  const names = await db.select({ address: seals.address, displayName: seals.displayName, handle: seals.handle }).from(seals).where(inArray(seals.address, sealAddresses));
  const byAddress = new Map(names.map((n) => [n.address.toLowerCase(), n.displayName ?? n.handle]));
  return sealAddresses
    .map((seal) => ({ seal, name: byAddress.get(seal) ?? `${seal.slice(0, 8)}…${seal.slice(-4)}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
