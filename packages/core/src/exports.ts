import { and, eq, gte, lte } from "drizzle-orm";

import { chainEvents, invoices, type Database } from "@symbolon/db";
import { formatAmount } from "@symbolon/seal";

const HEADER = [
  "block",
  "tx_hash",
  "fingerprint",
  "invoice_number",
  "vendor_seal",
  "invoice_total",
  "credited",
  "paid",
  "discount_bps",
  "payout_domain",
  "payout_address",
] as const;

/** RFC 4180 field: quoted when it contains a comma, quote or newline; formula-leading characters neutralised */
function field(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Settled payments for a business as CSV, straight from the ledger events sync stored (spec §11: exports and
 * reconciliation). Amounts at full token precision; nothing rounded away.
 */
export async function paymentsCsv(
  db: Database,
  businessId: string,
  opts: { fromBlock?: bigint; toBlock?: bigint; decimals?: number } = {},
): Promise<string> {
  const decimals = opts.decimals ?? 6;
  const mine = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const byFp = new Map(mine.map((i) => [i.fingerprint, i]));
  if (byFp.size === 0) return `${HEADER.join(",")}\n`;

  const conditions = [eq(chainEvents.eventName, "Settled")];
  if (opts.fromBlock !== undefined) conditions.push(gte(chainEvents.blockNumber, opts.fromBlock));
  if (opts.toBlock !== undefined) conditions.push(lte(chainEvents.blockNumber, opts.toBlock));
  const events = (await db.select().from(chainEvents).where(and(...conditions))).filter((e) =>
    byFp.has(String((e.args as { fingerprint?: string }).fingerprint).toLowerCase()),
  );
  events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

  const rows = events.map((e) => {
    const a = e.args as Record<string, string | number>;
    const inv = byFp.get(String(a.fingerprint).toLowerCase())!;
    return [
      e.blockNumber.toString(),
      e.txHash,
      inv.fingerprint,
      inv.invoiceNumber,
      inv.seal,
      formatAmount(inv.total, decimals),
      formatAmount(BigInt(a.credit!), decimals),
      formatAmount(BigInt(a.paid!), decimals),
      String(a.discountBps),
      String(a.payoutDomain),
      String(a.payoutAddress).toLowerCase(),
    ]
      .map(field)
      .join(",");
  });
  return `${[HEADER.join(","), ...rows].join("\n")}\n`;
}

