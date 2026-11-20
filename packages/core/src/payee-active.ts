import { and, desc, eq } from "drizzle-orm";

import { businesses, decisions, seals, type Database } from "@symbolon/db";

import { notifyBusiness, notifyVendor } from "./domain-notifications.js";

/**
 * Tells a vendor their payee record became active. Becoming active is a moment in time, not a transaction, so it is
 * noticed where time is already looked at: a Steward run, or the vendor opening their own page. Each payee gets one
 * notice, so calling this often is harmless.
 */
export async function notifyPayeesActive(db: Database, scope: { businessId: string } | { seal: string }, now: Date = new Date()): Promise<number> {
  const where =
    "businessId" in scope
      ? and(eq(decisions.kind, "payee_added"), eq(decisions.businessId, scope.businessId))
      : and(eq(decisions.kind, "payee_added"), eq(decisions.subject, scope.seal.toLowerCase()));
  const rows = await db
    .select({ businessId: decisions.businessId, subject: decisions.subject, record: decisions.record, hash: decisions.hash, name: businesses.name })
    .from(decisions)
    .innerJoin(businesses, eq(businesses.id, decisions.businessId))
    .where(where)
    .orderBy(desc(decisions.createdAt))
    .limit(50);

  let told = 0;
  for (const row of rows) {
    const inputs = (row.record as { inputs?: { activeAt?: unknown; txHash?: unknown } }).inputs ?? {};
    const activeAt = typeof inputs.activeAt === "string" && /^\d+$/.test(inputs.activeAt) ? Number(inputs.activeAt) * 1000 : null;
    if (!row.subject || activeAt === null || activeAt > now.getTime()) continue;
    const key = typeof inputs.txHash === "string" ? inputs.txHash : row.hash;
    const [sealRow] = await db.select({ name: seals.displayName }).from(seals).where(eq(seals.address, row.subject.toLowerCase())).limit(1);
    const result = await notifyVendor(db, row.subject, {
      kind: "payee_active",
      subject: row.subject,
      body: { businessId: row.businessId, businessName: row.name },
      dedupeKey: `payee_active:${row.businessId}:${key}`,
    });
    await notifyBusiness(db, row.businessId, {
      kind: "payee_active_business",
      subject: row.subject,
      body: { seal: row.subject, ...(sealRow?.name ? { vendorName: sealRow.name } : {}) },
      dedupeKey: `payee_active_biz:${row.businessId}:${key}`,
    }, { roles: ["owner"] });
    told += result.inserted;
  }
  return told;
}
