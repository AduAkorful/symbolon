import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { businesses, chainEvents, deliveries, invoices, purchaseOrders, seals, type Database } from "@symbolon/db";
import { formatAmount } from "@symbolon/seal";

export const PAYMENTS_CSV_HEADER = [
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
  "vendor_name",
  "token",
  "settled_at",
  "po_ref",
  "po_number",
  "delivery_confirmed",
  "delivery_tx",
  "decision_hash",
  "payer_vault",
] as const;

/** RFC 4180 field: quoted when it contains a comma, quote or newline; formula-leading characters neutralised */
export function field(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Cleans control characters from arbitrary text fields before CSV/export formatting */
export function cleanControlChars(v: string): string {
  return v.replace(/[\x00-\x1F\x7F]/g, " ").trim();
}

/**
 * Placeholder account names for Beancount export per K16.
 * Accountants map these to their actual chart of accounts.
 * Symbolon makes no tax or GAAP claim.
 */
export const BEANCOUNT_ACCOUNTS = {
  expensesPayablesPrefix: "Expenses:Payables",
  assetsVaultPrefix: "Assets:Symbolon:Vault",
  incomeDiscounts: "Income:EarlyPayDiscounts",
} as const;

export function resolveTokenSymbol(tokenAddress: string): string {
  const t = tokenAddress.toLowerCase();
  if (t === "0x1800000000000000000000000000000000000001" || t === "0x3600000000000000000000000000000000000000" || t.includes("usdc")) {
    return "USDC";
  }
  if (t === "0x8900000000000000000000000000000000000000" || t.includes("eurc")) {
    return "EURC";
  }
  if (t.includes("usyc")) {
    return "USYC";
  }
  return "USDC";
}

interface LoadedPaymentData {
  event: typeof chainEvents.$inferSelect;
  invoice: typeof invoices.$inferSelect;
  vendorName: string;
  tokenSymbol: string;
  settledAt: string;
  poRef: string;
  poNumber: string;
  deliveryConfirmed: string;
  deliveryTx: string;
  decisionHash: string;
  payerVault: string;
  credit: bigint;
  paid: bigint;
  discountBps: number;
  payoutDomain: number;
  payoutAddress: string;
}

async function loadSettledPaymentData(
  db: Database,
  businessId: string,
  opts: { fromBlock?: bigint; toBlock?: bigint; fromDate?: Date; toDate?: Date } = {},
): Promise<LoadedPaymentData[]> {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  const payerVault = biz?.vault?.toLowerCase() ?? "";

  const mine = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const byFp = new Map(mine.map((i) => [i.fingerprint.toLowerCase(), i]));
  if (byFp.size === 0) return [];

  const conditions = [eq(chainEvents.eventName, "Settled")];
  if (opts.fromBlock !== undefined) conditions.push(gte(chainEvents.blockNumber, opts.fromBlock));
  if (opts.toBlock !== undefined) conditions.push(lte(chainEvents.blockNumber, opts.toBlock));
  if (opts.fromDate !== undefined) conditions.push(gte(chainEvents.blockTime, opts.fromDate));
  if (opts.toDate !== undefined) conditions.push(lte(chainEvents.blockTime, opts.toDate));

  const events = (await db.select().from(chainEvents).where(and(...conditions))).filter((e) =>
    byFp.has(String((e.args as { fingerprint?: string }).fingerprint).toLowerCase()),
  );
  events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

  // Vendor names from seals
  const sealsList = await db.select().from(seals);
  const sealMap = new Map(sealsList.map((s) => [s.address.toLowerCase(), s.displayName || s.handle || s.address]));

  // Purchase orders
  const poList = await db.select().from(purchaseOrders).where(eq(purchaseOrders.businessId, businessId));
  const poMap = new Map(poList.map((po) => [po.poRef.toLowerCase(), po.poNumber]));

  // Deliveries
  const delList = await db.select().from(deliveries).where(eq(deliveries.businessId, businessId));
  const delMap = new Map(delList.map((d) => [d.fingerprint.toLowerCase(), d]));

  // Decisions from Vault Paid events if available
  const decisionHashMap = new Map<string, string>();
  if (payerVault) {
    const paidEvents = await db
      .select()
      .from(chainEvents)
      .where(and(eq(chainEvents.address, payerVault), eq(chainEvents.eventName, "Paid")));
    for (const pe of paidEvents) {
      const a = pe.args as { fingerprint?: string; decisionHash?: string };
      if (a.fingerprint && a.decisionHash) {
        decisionHashMap.set(a.fingerprint.toLowerCase(), a.decisionHash);
      }
    }
  }

  return events.map((e) => {
    const a = e.args as Record<string, string | number>;
    const inv = byFp.get(String(a.fingerprint).toLowerCase())!;
    const vendorName = sealMap.get(inv.seal.toLowerCase()) || inv.seal;
    const poNumber = inv.poRef ? poMap.get(inv.poRef.toLowerCase()) ?? "" : "";
    const delivery = delMap.get(inv.fingerprint.toLowerCase());
    const deliveryConfirmed = delivery
      ? delivery.state === "confirmed"
        ? "yes"
        : delivery.state === "rejected"
          ? "no"
          : "pending"
      : inv.poRef
        ? "pending"
        : "not required";
    const deliveryTx = delivery?.txHash ?? "";
    const decisionHash = decisionHashMap.get(inv.fingerprint.toLowerCase()) ?? "";
    const settledAt = e.blockTime ? e.blockTime.toISOString() : "";

    return {
      event: e,
      invoice: inv,
      vendorName,
      tokenSymbol: resolveTokenSymbol(inv.token),
      settledAt,
      poRef: inv.poRef ?? "",
      poNumber,
      deliveryConfirmed,
      deliveryTx,
      decisionHash,
      payerVault,
      credit: BigInt(a.credit ?? 0),
      paid: BigInt(a.paid ?? 0),
      discountBps: Number(a.discountBps ?? 0),
      payoutDomain: Number(a.payoutDomain ?? 0),
      payoutAddress: String(a.payoutAddress ?? "").toLowerCase(),
    };
  });
}

/**
 * Settled payments for a business as CSV, straight from the ledger events sync stored (spec §7.8, §11, K15).
 * Amounts at full token precision; nothing rounded away.
 */
export async function paymentsCsv(
  db: Database,
  businessId: string,
  opts: { fromBlock?: bigint; toBlock?: bigint; fromDate?: Date; toDate?: Date; decimals?: number } = {},
): Promise<string> {
  const decimals = opts.decimals ?? 6;
  const items = await loadSettledPaymentData(db, businessId, opts);
  if (items.length === 0) return `${PAYMENTS_CSV_HEADER.join(",")}\n`;

  const rows = items.map((item) => {
    return [
      item.event.blockNumber.toString(),
      item.event.txHash,
      item.invoice.fingerprint,
      cleanControlChars(item.invoice.invoiceNumber),
      item.invoice.seal,
      formatAmount(item.invoice.total, decimals),
      formatAmount(item.credit, decimals),
      formatAmount(item.paid, decimals),
      String(item.discountBps),
      String(item.payoutDomain),
      item.payoutAddress,
      cleanControlChars(item.vendorName),
      item.tokenSymbol,
      item.settledAt,
      item.poRef,
      cleanControlChars(item.poNumber),
      item.deliveryConfirmed,
      item.deliveryTx,
      item.decisionHash,
      item.payerVault,
    ]
      .map(field)
      .join(",");
  });

  return `${[PAYMENTS_CSV_HEADER.join(","), ...rows].join("\n")}\n`;
}

/**
 * Plain-text ledger export in Beancount format (spec §7.8, K16).
 * Postings balance exactly to zero integer units.
 */
export async function paymentsBeancount(
  db: Database,
  businessId: string,
  opts: { fromBlock?: bigint; toBlock?: bigint; fromDate?: Date; toDate?: Date; decimals?: number } = {},
): Promise<string> {
  const decimals = opts.decimals ?? 6;
  const items = await loadSettledPaymentData(db, businessId, opts);

  const header = [
    "; Symbolon plain-text ledger export (Beancount format)",
    "; Account names are placeholders for the business to map to its chart of accounts.",
    "; Symbolon makes no tax or GAAP claim.",
    "",
  ].join("\n");

  if (items.length === 0) return header;

  const txs = items.map((item) => {
    const dateStr = item.event.blockTime
      ? item.event.blockTime.toISOString().slice(0, 10)
      : "2026-09-30";
    const vendorSafe = cleanControlChars(item.vendorName).replace(/"/g, '\\"');
    const invoiceNumSafe = cleanControlChars(item.invoice.invoiceNumber).replace(/"/g, '\\"');
    const vendorSlug = cleanControlChars(item.vendorName).replace(/[^a-zA-Z0-9]/g, "") || "Vendor";

    const creditStr = formatAmount(item.credit, decimals);
    const paidStr = formatAmount(item.paid, decimals);
    const discount = item.credit > item.paid ? item.credit - item.paid : 0n;
    const discountStr = discount > 0n ? formatAmount(discount, decimals) : "0";

    const lines = [
      `${dateStr} * "${vendorSafe}" "Invoice ${invoiceNumSafe}"`,
      `  fingerprint: "${item.invoice.fingerprint}"`,
      `  tx: "${item.event.txHash}"`,
      `  decision: "${item.decisionHash || "none"}"`,
      `  po: "${item.poNumber || "none"}"`,
      `  delivery: "${item.deliveryConfirmed}"`,
      `  ${BEANCOUNT_ACCOUNTS.expensesPayablesPrefix}:${vendorSlug}  ${creditStr} ${item.tokenSymbol}`,
      `  ${BEANCOUNT_ACCOUNTS.assetsVaultPrefix}:${item.tokenSymbol}  -${paidStr} ${item.tokenSymbol}`,
    ];

    if (discount > 0n) {
      lines.push(`  ${BEANCOUNT_ACCOUNTS.incomeDiscounts}  -${discountStr} ${item.tokenSymbol}`);
    }

    return lines.join("\n");
  });

  return `${header}${txs.join("\n\n")}\n`;
}
