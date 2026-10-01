import { and, eq, inArray } from "drizzle-orm";
import type { Hex } from "viem";

import { invoiceStatus, type SymbolonContracts } from "@symbolon/chain";
import { decisions, invoices, type Database } from "@symbolon/db";

export interface Mismatch {
  fingerprint: string;
  invoiceNumber: string;
  field: "credited" | "status";
  database: string;
  ledger: string;
}

/**
 * Flow 11: every invoice the database thinks is (partly) paid or cancelled is checked against the ledger, to the last
 * unit. Mismatches are returned for a human, never corrected silently here (sync is the only writer).
 */
export async function reconcile(db: Database, contracts: SymbolonContracts, businessId: string): Promise<Mismatch[]> {
  const rows = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const out: Mismatch[] = [];
  for (const row of rows) {
    const s = await invoiceStatus(contracts, row.fingerprint as Hex);
    if (s.credited !== row.credited) {
      out.push({ fingerprint: row.fingerprint, invoiceNumber: row.invoiceNumber, field: "credited", database: row.credited.toString(), ledger: s.credited.toString() });
    }
    const ledgerStatus = s.cancelled ? "cancelled" : s.paid ? "paid" : s.credited > 0n ? "partially_paid" : "open";
    const dbSettled = ["paid", "partially_paid", "cancelled"].includes(row.status);
    if ((dbSettled || ledgerStatus !== "open") && row.status !== ledgerStatus) {
      out.push({ fingerprint: row.fingerprint, invoiceNumber: row.invoiceNumber, field: "status", database: row.status, ledger: ledgerStatus });
    }
  }
  return out;
}

export interface ShadowAgreement {
  compared: number;
  agreed: number;
  /** agreed / compared in bps (10,000 = full agreement); undefined until something can be compared */
  rateBps?: number;
  disagreements: { fingerprint: string; steward: string; actual: string }[];
}

/**
 * Flow 13: how often the Steward's shadow-mode call matched what the team actually did. "Would pay / schedule" agrees
 * with an invoice that got paid; "hold" or "reject" agrees with one that didn't. Undecided invoices aren't counted.
 */
export async function shadowAgreement(db: Database, businessId: string): Promise<ShadowAgreement> {
  const shadow = await db.select().from(decisions).where(and(eq(decisions.businessId, businessId), inArray(decisions.kind, ["pay", "schedule", "hold", "reject"])));
  const latest = new Map<string, (typeof shadow)[number]>();
  for (const d of shadow) {
    if (!d.subject || (d.record as { mode?: string }).mode !== "shadow") continue;
    const prev = latest.get(d.subject);
    if (!prev || prev.createdAt < d.createdAt) latest.set(d.subject, d);
  }
  const fps = [...latest.keys()];
  const rows = fps.length ? await db.select().from(invoices).where(inArray(invoices.fingerprint, fps)) : [];
  const result: ShadowAgreement = { compared: 0, agreed: 0, disagreements: [] };
  for (const row of rows) {
    const settled = row.status === "paid" || row.status === "partially_paid";
    const closedUnpaid = row.status === "rejected" || row.status === "cancelled";
    if (!settled && !closedUnpaid) continue;
    const call = latest.get(row.fingerprint)!.kind;
    const wouldPay = call === "pay" || call === "schedule";
    result.compared += 1;
    if (wouldPay === settled) result.agreed += 1;
    else result.disagreements.push({ fingerprint: row.fingerprint, steward: call, actual: row.status });
  }
  if (result.compared > 0) result.rateBps = Math.floor((result.agreed * 10_000) / result.compared);
  return result;
}


/** Plan 05p A7: only latest eligible, explicitly linked human responses count. */
export async function humanResponseAgreement(db: Database, businessId: string): Promise<{agreed:number;total:number}> {
  const rows = await db.select().from(decisions).where(eq(decisions.businessId,businessId));
  const recommendations = new Map(rows.filter((r) => {
    const record = r.record as { outcome?: string };
    return !["approval_granted","approval_rejected"].includes(r.kind) && ["request_approval","proposed"].includes(record.outcome ?? "");
  }).map((r) => [r.hash.toLowerCase(),r]));
  const latest = new Map<string,typeof rows[number]>();
  for (const row of rows) {
    if (!["approval_granted","approval_rejected"].includes(row.kind)) continue;
    const record = row.record as { inputs?: {recommendation?:unknown}; recommendation?:unknown };
    const link = record.inputs?.recommendation ?? record.recommendation;
    if (typeof link !== "string") continue;
    const key = link.toLowerCase();
    const recommendation = recommendations.get(key);
    if (!recommendation || recommendation.subject !== row.subject || row.createdAt < recommendation.createdAt) continue;
    const previous = latest.get(key);
    if (!previous || previous.createdAt < row.createdAt || (previous.createdAt.getTime() === row.createdAt.getTime() && row.id > previous.id)) latest.set(key,row);
  }
  return {total:latest.size,agreed:[...latest.values()].filter((r) => r.kind === "approval_granted").length};
}
