import "server-only";

import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import { invoices, payees, unsignedBills, type Database } from "@symbolon/db";

export interface NavCounts {
  /** Things in the inbox to look at: bills nobody sealed, and open invoices from vendors this business hasn't verified yet */
  inbox: number;
  /** Invoices waiting for a person's sign-off */
  approvals: number;
}

/**
 * The numbers beside Inbox and Approvals in the navigation. They come from one place, counted the same way on every page, from
 * the database only (no chain reads), so the menu never waits on a node and never disagrees with itself between screens.
 */
export async function loadNavCounts(db: Database, businessId: string): Promise<NavCounts> {
  const [approvals] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "awaiting_approval")));

  const [unverified] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ["received", "verified", "held", "awaiting_approval"]),
        notExists(
          db
            .select({ one: sql`1` })
            .from(payees)
            .where(and(eq(payees.businessId, invoices.businessId), eq(payees.seal, invoices.seal), eq(payees.status, "verified"))),
        ),
      ),
    );

  const [bills] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(unsignedBills)
    .where(and(eq(unsignedBills.businessId, businessId), eq(unsignedBills.status, "open")));

  return { inbox: (unverified?.n ?? 0) + (bills?.n ?? 0), approvals: approvals?.n ?? 0 };
}
