import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assessUnsigned, type Extraction, type KnownVendor } from "@symbolon/steward";
import { payees, seals, unsignedBills, type Database } from "@symbolon/db";
import { requireMember, type Role } from "./access";
import { AuthError } from "./errors";
import { appendAppDecision } from "./app-decisions";
import { readUploadWithExtraction } from "./upload";
import type { StewardModel } from "@symbolon/steward";

const BILL_ROLES: Role[] = ["owner", "approver", "requester"];

function fileHash(bytes: Uint8Array) {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

async function knownVendors(db: Database, businessId: string): Promise<KnownVendor[]> {
  const rows = await db.select({ seal: seals.address, displayName: seals.displayName, legalName: seals.legalName, website: seals.website })
    .from(payees)
    .innerJoin(seals, eq(seals.address, payees.seal))
    .where(and(eq(payees.businessId, businessId), eq(payees.status, "verified")));
  return rows.map((row) => ({
    seal: row.seal,
    displayName: row.displayName,
    ...(row.legalName ? { legalName: row.legalName } : {}),
    ...(row.website ? { website: row.website } : {}),
  }));
}

export async function addUnsignedBill(
  db: Database,
  user: { id: string },
  businessId: string,
  file: { bytes: Uint8Array; name: string },
  model: StewardModel | null,
) {
  await requireMember(db, user.id, businessId, ...BILL_ROLES);
  if (!model) throw new AuthError(503, "Reading uploaded bills isn't available on this server yet. No bill was stored.");
  const hash = fileHash(file.bytes);
  const existing = await db.select().from(unsignedBills).where(and(eq(unsignedBills.businessId, businessId), eq(unsignedBills.fileSha256, hash))).limit(1);
  if (existing[0]) return existing[0];
  const read = await readUploadWithExtraction(model, { bytes: file.bytes, name: file.name });
  if (!read.ok) throw new AuthError(400, read.reason);
  const raw = read.extraction as Extraction;
  const assessment = assessUnsigned(raw, await knownVendors(db, businessId));
  const storedExtraction = { ...raw, prefill: read.prefill, fromFile: read.fromFile } as Record<string, unknown>;
  const storedAssessment = assessment as unknown as Record<string, unknown>;
  const [bill] = await db.insert(unsignedBills).values({
    businessId,
    uploadedBy: user.id,
    fileName: file.name.slice(0, 255),
    fileSha256: hash,
    extraction: storedExtraction,
    assessment: storedAssessment,
  }).onConflictDoNothing().returning();
  if (!bill) return (await db.select().from(unsignedBills).where(and(eq(unsignedBills.businessId, businessId), eq(unsignedBills.fileSha256, hash))).limit(1))[0]!;
  await appendAppDecision(db, businessId, { kind: "unsigned_bill", subject: bill.id, actor: user.id, inputs: { fileName: bill.fileName, fileSha256: hash, verdict: assessment.verdict }, rule: "unsigned documents are never payable", outcome: "held" });
  return bill;
}

export async function updateUnsignedBill(db: Database, user: { id: string }, businessId: string, id: string, status: "fraud" | "dismissed") {
  await requireMember(db, user.id, businessId, "owner", "approver");
  const [bill] = await db.update(unsignedBills).set({ status }).where(and(eq(unsignedBills.id, id), eq(unsignedBills.businessId, businessId))).returning();
  if (!bill) throw new AuthError(404, "That bill isn't in this business's inbox.");
  await appendAppDecision(db, businessId, { kind: status === "fraud" ? "fraud_mark" : "unsigned_dismiss", subject: id, actor: user.id, inputs: { bill: id }, rule: status === "fraud" ? "member marked unsigned bill as fraud" : "member dismissed unsigned bill", outcome: status });
  return bill;
}
