import { and, eq, inArray } from "drizzle-orm";

import { invoices, type Database } from "@symbolon/db";
import type { CashFlow } from "@symbolon/steward";

/**
 * The one definition of "bills" every cash figure uses (QA R25-8): the Treasury shortfall, the lending section's "bills due within
 * your buffer" and the Steward's own lending/reserve check all count the same invoices, in the same token, so their numbers agree.
 * Before, the Steward added EURC bills to its USDC target, the Treasury callout counted held invoices and the lending section didn't.
 */
export const BILL_STATUSES = ["verified", "scheduled", "awaiting_approval", "partially_paid", "held"] as const;

/** What is still owed on an invoice, never negative */
export function owedOn(row: { total: bigint; credited: bigint }): bigint {
  return row.total > row.credited ? row.total - row.credited : 0n;
}

/** Open bills of one business in one token (the Vault's USDC for the operating buffer), as cash flows by due date */
export async function billFlows(db: Database, businessId: string, token: string): Promise<CashFlow[]> {
  const rows = await db
    .select({ fingerprint: invoices.fingerprint, total: invoices.total, credited: invoices.credited, dueDate: invoices.dueDate })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.token, token.toLowerCase()), inArray(invoices.status, [...BILL_STATUSES])));
  return rows.map((o) => ({ at: BigInt(Math.floor(o.dueDate.getTime() / 1000)), amount: owedOn(o), direction: "out" as const, ref: o.fingerprint }));
}

/** The cash the Steward keeps before it lends or sweeps: the larger of the operating floor and the bills due within the buffer */
export function cashToKeep(minOperating: bigint, billsDue: bigint): bigint {
  return minOperating > billsDue ? minOperating : billsDue;
}
