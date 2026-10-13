import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { invoices, vendorRequests, type Database } from "@symbolon/db";

/**
 * Why a cancelled invoice is cancelled, so the screen says the true thing (plan 05zj F, SYM-43). Before this every cancelled
 * invoice said "Replacement or credit note registered". A replacement is a later invoice that names this one; a credit note and a
 * plain cancellation are the vendor's own signed requests. If none of them is found, it is said as cancelled, nothing more.
 */
export type CancelCause = "replaced" | "credit_note" | "cancelled";

export async function cancelCause(db: Database, fingerprint: string): Promise<{ cause: CancelCause; replacedBy?: string }> {
  const fp = fingerprint.toLowerCase();
  const [replacement] = await db.select({ fingerprint: invoices.fingerprint }).from(invoices).where(eq(invoices.replaces, fp)).limit(1);
  if (replacement) return { cause: "replaced", replacedBy: replacement.fingerprint };
  const [request] = await db
    .select({ kind: vendorRequests.kind })
    .from(vendorRequests)
    .where(and(sql`${vendorRequests.message}->>'fingerprint' = ${fp}`, sql`${vendorRequests.kind} in ('credit_note', 'cancel')`))
    .limit(1);
  if (request?.kind === "credit_note") return { cause: "credit_note" };
  return { cause: "cancelled" };
}
