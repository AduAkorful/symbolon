import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { getAddress, type Address, type PublicClient } from "viem";
import { businesses, invoices, members, payees, seals, vendorVerifications, type Database } from "@symbolon/db";
import { symbolonContracts } from "@symbolon/chain";
import type { Deployment } from "@symbolon/chain";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const digest = (id: string, code: string) => createHmac("sha256", id).update(code).digest("hex");
function codeKey(): Buffer {
  const raw = process.env.VERIFICATION_CODE_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) throw new AuthError(503, "Code verification is unavailable until the server verification key is configured.");
  return Buffer.from(raw, "hex");
}
function encryptCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", codeKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}
function decryptCode(value: string): string {
  const [iv, tag, ciphertext] = value.split(":");
  if (!iv || !tag || !ciphertext) throw new AuthError(503, "The verification code can't be decrypted right now.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", codeKey(), Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
  } catch { throw new AuthError(503, "The verification code can't be decrypted right now."); }
}
const normalizeSeal = (seal: unknown) => {
  try { return getAddress(seal as string).toLowerCase(); } catch { throw new AuthError(400, "That Seal address is malformed."); }
};

/** Materializes expiry and its append-only decision before any later action can use an overdue request. */
export async function expireVerifications(db: Database, filter: { id?: string; businessId?: string; seal?: string } = {}) {
  const now = new Date();
  const filters = [inArray(vendorVerifications.status, ["open", "awaiting_second"] as const), lte(vendorVerifications.expiresAt, now)];
  if (filter.id) filters.push(eq(vendorVerifications.id, filter.id));
  if (filter.businessId) filters.push(eq(vendorVerifications.businessId, filter.businessId));
  if (filter.seal) filters.push(eq(vendorVerifications.seal, filter.seal));
  const due = await db.select().from(vendorVerifications).where(and(...filters));
  for (const row of due) await db.transaction(async (tx) => {
    const [expired] = await tx.update(vendorVerifications).set({ status: "expired", updatedAt: now }).where(and(eq(vendorVerifications.id, row.id), inArray(vendorVerifications.status, ["open", "awaiting_second"]), lte(vendorVerifications.expiresAt, now))).returning({ id: vendorVerifications.id });
    if (expired) await appendAppDecision(tx, row.businessId, { kind: "vendor_verification_expired", subject: row.seal ?? row.id, actor: "system", inputs: { verificationId: row.id, method: row.method, priorStatus: row.status, expiresAt: row.expiresAt?.toISOString() ?? "" }, rule: "verification requests expire at their recorded expiry", outcome: "expired" });
  });
}

export async function startCodeVerification(db: Database, user: Pick<SessionUser, "id">, businessId: string, sealValue: unknown, cap: unknown = null) {
  await requireMember(db, user.id, businessId, "owner", "approver");
  const seal = normalizeSeal(sealValue);
  const [existingPayee] = await db.select({ status: payees.status }).from(payees).where(and(eq(payees.businessId, businessId), eq(payees.seal, seal))).limit(1);
  if (existingPayee?.status === "blocked") throw new AuthError(403, "This business has blocked this Seal; callback verification can't override that decision.");
  const [vendor] = await db.select({ userId: seals.userId }).from(seals).where(and(eq(seals.address, seal), isNull(seals.rotatedTo))).limit(1);
  const [membership] = await db.select({ userId: members.userId }).from(members).where(and(eq(members.businessId, businessId), eq(members.userId, vendor?.userId ?? "00000000-0000-0000-0000-000000000000"))).limit(1);
  if (!vendor || membership) throw new AuthError(403, "This Seal can't be verified by code for this business.");
  const [invoice] = await db.select({ fingerprint: invoices.fingerprint }).from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal))).orderBy(desc(invoices.total)).limit(1);
  if (!invoice) throw new AuthError(409, "Code verification is available only after this Seal has sent the business an invoice.");
  let capRaw: bigint | null = null;
  if (cap !== null && cap !== undefined && cap !== "") {
    if (typeof cap !== "string" || !/^\d{1,24}$/.test(cap) || BigInt(cap) <= 0n) throw new AuthError(400, "Enter a valid positive cap in raw token units.");
    capRaw = BigInt(cap);
  }
  const id = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await expireVerifications(db, { businessId, seal });
  try {
    await db.transaction(async (tx) => {
      await tx.insert(vendorVerifications).values({ id, businessId, seal, method: "code", status: "open", raisedBy: user.id, codeHmac: digest(id, code), codeCiphertext: encryptCode(code), attempts: 0, expiresAt, cap: capRaw, invoiceFingerprint: invoice.fingerprint });
      await appendAppDecision(tx, businessId, { kind: "vendor_code_requested", subject: seal, actor: user.id, inputs: { verificationId: id, invoiceFingerprint: invoice.fingerprint, expiresAt: expiresAt.toISOString() }, rule: "only a Seal with an invoice to this business may receive a callback code", outcome: "open" });
    });
  } catch (e) {
    if (/unique|duplicate/i.test(String(e))) throw new AuthError(409, "A code verification is already open for this vendor.");
    throw e;
  }
  return { id, expiresAt };
}

/** Only the account that owns the Seal can retrieve an unexpired code. */
export async function showCodeToSeal(db: Database, user: Pick<SessionUser, "id">, requestId?: string) {
  await expireVerifications(db, requestId ? { id: requestId } : {});
  const rows = await db.select({ verification: vendorVerifications, businessName: businesses.name, vault: businesses.vault }).from(vendorVerifications).innerJoin(businesses, eq(businesses.id, vendorVerifications.businessId)).innerJoin(seals, eq(seals.address, vendorVerifications.seal!)).where(and(eq(seals.userId, user.id), isNull(seals.rotatedTo), eq(vendorVerifications.method, "code"), eq(vendorVerifications.status, "open"), gt(vendorVerifications.expiresAt, new Date()), requestId ? eq(vendorVerifications.id, requestId) : undefined)).orderBy(desc(vendorVerifications.createdAt));
  return rows.map(({ verification, businessName, vault }) => ({ id: verification.id, businessName, vault, expiresAt: verification.expiresAt, code: decryptCode(verification.codeCiphertext!) }));
}

export async function submitCode(db: Database, user: Pick<SessionUser, "id">, client: PublicClient, deployment: Deployment, requestId: string, codeValue: unknown, contactedValue: unknown, channelValue: unknown) {
  await expireVerifications(db, { id: requestId });
  if (typeof codeValue !== "string" || !/^\d{6}$/.test(codeValue)) throw new AuthError(400, "Enter the six-digit code.");
  const contacted = typeof contactedValue === "string" ? contactedValue.trim() : "";
  const channel = typeof channelValue === "string" ? channelValue.trim() : "";
  if (!contacted || contacted.length > 120 || !channel || channel.length > 120) throw new AuthError(400, "Record who you reached and the trusted channel you used.");
  const [v] = await db.select().from(vendorVerifications).where(and(eq(vendorVerifications.id, requestId), eq(vendorVerifications.method, "code"), eq(vendorVerifications.status, "open"))).limit(1);
  if (!v || !v.seal || !v.expiresAt || v.expiresAt <= new Date()) throw new AuthError(404, "This verification request can't be used.");
  await requireMember(db, user.id, v.businessId, "owner", "approver");
  if (v.raisedBy === user.id) throw new AuthError(403, "A different member must confirm this verification.");
  const expected = Buffer.from(v.codeHmac!, "hex");
  const actual = Buffer.from(digest(v.id, codeValue), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    const attempts = await db.transaction(async (tx) => {
      const [updated] = await tx.update(vendorVerifications).set({ attempts: sql`${vendorVerifications.attempts} + 1`, status: sql`case when ${vendorVerifications.attempts} + 1 >= 5 then 'expired'::vendor_verification_status else 'open'::vendor_verification_status end`, updatedAt: new Date() }).where(and(eq(vendorVerifications.id, v.id), eq(vendorVerifications.status, "open"))).returning({ attempts: vendorVerifications.attempts });
      const count = updated?.attempts ?? 5;
      await appendAppDecision(tx, v.businessId, { kind: count >= 5 ? "vendor_code_expired" : "vendor_code_mismatch", subject: v.seal!, actor: user.id, inputs: { verificationId: v.id, attempts: count }, rule: "callback codes are checked in constant time and expire after five incorrect attempts", outcome: count >= 5 ? "expired" : "incorrect" });
      return count;
    });
    throw new AuthError(400, attempts >= 5 ? "This code has expired. Start a new verification." : "That code doesn't match.");
  }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, v.businessId)).limit(1);
  if (!business?.vault) throw new AuthError(409, "This business has no Vault to verify against.");
  const state = await symbolonContracts(client, deployment).lens.read.getVaultState([getAddress(business.vault) as Address]);
  const threshold = BigInt(state.policy.ownerThreshold);
  const [largestInvoice] = await db.select({ fingerprint: invoices.fingerprint, total: invoices.total }).from(invoices).where(and(eq(invoices.businessId, v.businessId), eq(invoices.seal, v.seal))).orderBy(desc(invoices.total)).limit(1);
  const high = (v.cap !== null && v.cap > threshold) || (largestInvoice?.total ?? 0n) > threshold;
  if (high) {
    await db.transaction(async (tx) => {
      const [changed] = await tx.update(vendorVerifications).set({ status: "awaiting_second", confirmedBy: user.id, contacted, channel, updatedAt: new Date() }).where(and(eq(vendorVerifications.id, v.id), eq(vendorVerifications.status, "open"))).returning({ id: vendorVerifications.id });
      if (!changed) throw new AuthError(409, "This verification request has already been used.");
      await appendAppDecision(tx, v.businessId, { kind: "vendor_verification_awaiting_second", subject: v.seal!, actor: user.id, inputs: { verificationId: v.id, contacted, channel, threshold: threshold.toString(), ...(largestInvoice ? { invoiceFingerprint: largestInvoice.fingerprint, invoiceAmount: largestInvoice.total.toString() } : {}) }, rule: "cap or largest invoice on file exceeds the live Vault owner threshold", outcome: "awaiting_second" });
    });
    return { status: "awaiting_second" as const };
  }
  return finishVerification(db, v.id, v.businessId, v.seal!, user.id, "code", { contacted, channel }, "open");
}

export async function confirmSecond(db: Database, user: Pick<SessionUser, "id">, id: string) {
  await expireVerifications(db, { id });
  const [v] = await db.select().from(vendorVerifications).where(and(eq(vendorVerifications.id, id), eq(vendorVerifications.status, "awaiting_second"))).limit(1);
  if (!v?.seal || !v.confirmedBy || v.confirmedBy === user.id || v.raisedBy === user.id) throw new AuthError(403, "A different owner or approver must confirm this verification.");
  await requireMember(db, user.id, v.businessId, "owner", "approver");
  return finishVerification(db, v.id, v.businessId, v.seal!, user.id, v.method, { secondPerson: true }, "awaiting_second");
}

async function finishVerification(db: Database, id: string, businessId: string, seal: string, actor: string, method: "code" | "invitation", evidence: Record<string, unknown>, priorStatus: "open" | "awaiting_second") {
  const now = new Date();
  const [existingPayee] = await db.select({ status: payees.status }).from(payees).where(and(eq(payees.businessId, businessId), eq(payees.seal, seal))).limit(1);
  if (existingPayee?.status === "blocked") throw new AuthError(403, "This business has blocked this Seal; verification can't override that decision.");
  await db.transaction(async (tx) => {
    const [changed] = await tx.update(vendorVerifications).set({ status: "verified", ...(evidence.secondPerson ? { secondBy: actor } : { confirmedBy: actor }), updatedAt: now }).where(and(eq(vendorVerifications.id, id), eq(vendorVerifications.status, priorStatus))).returning({ id: vendorVerifications.id });
    if (!changed) throw new AuthError(409, "This verification request has already been used.");
    const [saved] = await tx.insert(payees).values({ businessId, seal, status: "verified", verificationMethod: method, verifiedBy: actor, verifiedAt: now }).onConflictDoUpdate({ target: [payees.businessId, payees.seal], set: { status: "verified", verificationMethod: method, verifiedBy: actor, verifiedAt: now }, setWhere: sql`${payees.status} <> 'blocked'` }).returning({ seal: payees.seal });
    if (!saved) throw new AuthError(403, "This business has blocked this Seal; verification can't override that decision.");
    await appendAppDecision(tx, businessId, { kind: evidence.secondPerson ? "vendor_verification_second_confirmed" : "vendor_verified_code", subject: seal, actor, inputs: { verificationId: id, ...evidence }, rule: evidence.secondPerson ? "a distinct owner or approver confirmed the first-contact check" : "the submitted callback code matched in constant time", outcome: "verified" });
  });
  return { status: "verified" as const };
}
