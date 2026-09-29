import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import type { PublicClient } from "viem";
import { businesses, invoices, members, payees, seals, vendorInvitations, vendorVerifications, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const cleanText = (value: unknown, label: string, max: number) => {
  if (typeof value !== "string") throw new AuthError(400, `${label} is required.`);
  const result = value.normalize("NFC").trim();
  if (!result || result.length > max || /[\p{Cc}\p{Cf}]/u.test(result)) throw new AuthError(400, `${label} must be 1 to ${max} characters, without control characters.`);
  return result;
};

/** Creates a 14-day bearer invite. The raw secret is returned once and is never persisted. */
export async function createInvitation(db: Database, user: Pick<SessionUser, "id">, businessId: string, input: { vendorName: unknown; contactNote: unknown; terms?: unknown }, origin: string) {
  await requireMember(db, user.id, businessId, "owner");
  const vendorName = cleanText(input.vendorName, "Vendor name", 120);
  const contactNote = cleanText(input.contactNote, "Contact note", 160);
  let terms: { monthlyCap: string; requirePo: boolean; requireDelivery: boolean } | null = null;
  if (input.terms !== undefined && input.terms !== null) {
    const t = input.terms as Record<string, unknown>;
    if (!t || typeof t !== "object" || typeof t.monthlyCap !== "string" || !/^\d{1,24}$/.test(t.monthlyCap) || BigInt(t.monthlyCap) <= 0n || typeof t.requirePo !== "boolean" || typeof t.requireDelivery !== "boolean") throw new AuthError(400, "Those invitation terms are invalid.");
    terms = { monthlyCap: t.monthlyCap, requirePo: t.requirePo, requireDelivery: t.requireDelivery };
  }
  const [business] = await db.select({ name: businesses.name, vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) throw new AuthError(404, "That business doesn't exist.");
  if (!business.vault) throw new AuthError(409, "Create this business's Vault before inviting a vendor.");
  const token = randomBytes(32).toString("base64url");
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(vendorInvitations).values({ businessId, vendorName, contactNote, tokenHash: sha(token), terms, createdBy: user.id, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) }).returning({ id: vendorInvitations.id });
    await appendAppDecision(tx, businessId, { kind: "vendor_invitation_created", subject: row!.id, actor: user.id, inputs: { vendorName, ...(terms ? { terms } : {}) }, rule: "owner invited a vendor using a single-use, expiring secret", outcome: "invited" });
    return row!.id;
  });
  return { id, link: `${origin.replace(/\/$/, "")}/invite/${token}` };
}

/** Invalid, expired, revoked, and accepted bearer tokens deliberately share one response. */
export async function loadInvitation(db: Database, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new AuthError(404, "This invitation can't be used.");
  const [row] = await db.select({ id: vendorInvitations.id, businessId: vendorInvitations.businessId, vendorName: vendorInvitations.vendorName, businessName: businesses.name, expiresAt: vendorInvitations.expiresAt, acceptedAt: vendorInvitations.acceptedAt, revokedAt: vendorInvitations.revokedAt }).from(vendorInvitations).innerJoin(businesses, eq(businesses.id, vendorInvitations.businessId)).where(eq(vendorInvitations.tokenHash, sha(token))).limit(1);
  if (!row || row.expiresAt <= new Date() || row.acceptedAt || row.revokedAt) throw new AuthError(404, "This invitation can't be used.");
  return { businessName: row.businessName, vendorName: row.vendorName };
}

export async function acceptInvitation(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new AuthError(404, "This invitation can't be used.");
  const now = new Date();
  const [candidate] = await db.select().from(vendorInvitations).where(and(eq(vendorInvitations.tokenHash, sha(token)), gt(vendorInvitations.expiresAt, now), isNull(vendorInvitations.acceptedAt), isNull(vendorInvitations.revokedAt))).limit(1);
  const invitation = candidate;
  if (!invitation) throw new AuthError(404, "This invitation can't be used.");
  const [seal] = await db.select().from(seals).where(and(eq(seals.userId, user.id), isNull(seals.rotatedTo))).orderBy(desc(seals.createdAt)).limit(1);
  if (!seal) throw new AuthError(409, "Create your Seal before accepting this invitation.");
  const sealAddress = getAddress(seal.address).toLowerCase();
  const [priorPayee] = await db.select({ status: payees.status }).from(payees).where(and(eq(payees.businessId, invitation.businessId), eq(payees.seal, sealAddress))).limit(1);
  if (priorPayee?.status === "blocked") throw new AuthError(403, "This business has blocked this Seal; the invitation can't override that decision.");
  const [business] = await db.select().from(businesses).where(eq(businesses.id, invitation.businessId)).limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault to verify against.");
  const state = await symbolonContracts(client, deployment).lens.read.getVaultState([getAddress(business.vault)]);
  const cap = invitation.terms ? BigInt(invitation.terms.monthlyCap) : null;
  const [pendingInvoice] = await db.select({ fingerprint: invoices.fingerprint, total: invoices.total }).from(invoices).where(and(eq(invoices.businessId, invitation.businessId), eq(invoices.seal, sealAddress))).orderBy(desc(invoices.total)).limit(1);
  const threshold = BigInt(state.policy.ownerThreshold);
  // A Seal this business already verified stays verified: a re-invite must never downgrade a passed check
  const requiresSecond = priorPayee?.status !== "verified" && ((cap !== null && cap > threshold) || (pendingInvoice?.total ?? 0n) > threshold);
  const status = requiresSecond ? "awaiting_second" as const : "verified" as const;
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(vendorInvitations).set({ acceptedAt: now, acceptedSeal: sealAddress }).where(and(eq(vendorInvitations.id, invitation.id), isNull(vendorInvitations.acceptedAt), isNull(vendorInvitations.revokedAt), gt(vendorInvitations.expiresAt, now))).returning({ id: vendorInvitations.id });
    if (!claimed) throw new AuthError(404, "This invitation can't be used.");
    const [saved] = await tx.insert(payees).values({ businessId: invitation.businessId, seal: sealAddress, status: requiresSecond ? "pending_verification" : "verified", ...(requiresSecond ? {} : { verificationMethod: "invitation", verifiedBy: invitation.createdBy, verifiedAt: now }) }).onConflictDoUpdate({ target: [payees.businessId, payees.seal], set: { status: requiresSecond ? "pending_verification" : "verified", verificationMethod: requiresSecond ? null : "invitation", verifiedBy: requiresSecond ? null : invitation.createdBy, verifiedAt: requiresSecond ? null : now }, setWhere: sql`${payees.status} <> 'blocked'` }).returning({ seal: payees.seal });
    if (!saved) throw new AuthError(403, "This business has blocked this Seal; the invitation can't override that decision.");
    await tx.insert(vendorVerifications).values({ businessId: invitation.businessId, seal: sealAddress, method: "invitation", status, raisedBy: invitation.createdBy, confirmedBy: invitation.createdBy, invitationId: invitation.id, cap, createdAt: now, updatedAt: now });
    await appendAppDecision(tx, invitation.businessId, { kind: requiresSecond ? "vendor_invitation_awaiting_second" : "vendor_verified_invitation", subject: sealAddress, actor: user.id, inputs: { invitationId: invitation.id, invitedBy: invitation.createdBy, ownerThreshold: threshold.toString(), ...(cap !== null ? { cap: cap.toString() } : {}), ...(pendingInvoice ? { pendingInvoice: pendingInvoice.total.toString(), invoiceFingerprint: pendingInvoice.fingerprint } : {}) }, rule: requiresSecond ? "vendor cap or largest invoice on file exceeds the live Vault owner threshold" : "vendor accepted a single-use invitation sent over a pre-existing trusted channel", outcome: status });
  });
  return { businessId: invitation.businessId, seal: sealAddress, status };
}

export async function revokeInvitation(db: Database, user: Pick<SessionUser, "id">, businessId: string, id: string) {
  await requireMember(db, user.id, businessId, "owner");
  return db.transaction(async (tx) => {
    const [row] = await tx.update(vendorInvitations).set({ revokedAt: new Date() }).where(and(eq(vendorInvitations.id, id), eq(vendorInvitations.businessId, businessId), isNull(vendorInvitations.acceptedAt), isNull(vendorInvitations.revokedAt))).returning({ id: vendorInvitations.id });
    if (!row) throw new AuthError(404, "That open invitation can't be found.");
    await appendAppDecision(tx, businessId, { kind: "vendor_invitation_revoked", subject: id, actor: user.id, inputs: {}, rule: "business owner revoked an unused invitation", outcome: "revoked" });
    return row;
  });
}
