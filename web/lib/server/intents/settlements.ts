import "server-only";
import { and, eq } from "drizzle-orm";
import { businesses, chainEvents, invoices } from "@symbolon/db";
import { formatAmount } from "@symbolon/seal";
import type { IntentContext } from "./types";

/** Settled is the source for cash paid, gross credit, signed discounts and settlement time. */
export async function intentSettlements(ctx: IntentContext) {
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId));
  const invoiceRows = await ctx.db.select().from(invoices).where(eq(invoices.businessId, ctx.businessId));
  const invoiceMap = new Map(invoiceRows.map((r) => [r.fingerprint.toLowerCase(), r]));
  const ledger = ctx.deployment.contracts?.invoiceLedger;
  if (!business?.vault || !ledger) return [];
  const events = await ctx.db.select().from(chainEvents).where(and(
    eq(chainEvents.chainId, business.chainId), eq(chainEvents.address, ledger.toLowerCase()), eq(chainEvents.eventName,"Settled"),
  ));
  return events.flatMap((event) => {
    const args = event.args;
    const invoice = invoiceMap.get(String(args.fingerprint).toLowerCase());
    if (!invoice || String(args.payer).toLowerCase() !== business.vault!.toLowerCase() || String(args.token).toLowerCase() !== invoice.token.toLowerCase()) return [];
    try {
      const paid = BigInt(String(args.paid));
      const credit = BigInt(String(args.credit));
      const discountBps = Number(args.discountBps);
      if (paid < 0n || credit < paid || !Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) return [];
      return [{event,invoice,paid,credit,discountBps,token:invoice.token.toLowerCase()}];
    } catch { return []; }
  });
}

export function currencyTotals(ctx: IntentContext, rows: {token:string;amount:bigint}[]): string {
  const totals = new Map<string,bigint>();
  for (const row of rows) totals.set(row.token.toLowerCase(),(totals.get(row.token.toLowerCase()) ?? 0n)+row.amount);
  return [...totals].map(([token,total]) => {
    const symbol = Object.entries(ctx.deployment.tokens ?? {}).find(([,address]) => address?.toLowerCase() === token)?.[0].toUpperCase();
    return symbol ? `${formatAmount(total,6)} ${symbol}` : `${total} raw units of ${token} (currency unavailable)`;
  }).join(" and ");
}
