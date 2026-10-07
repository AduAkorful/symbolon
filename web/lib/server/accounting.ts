import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { formatAmount } from "@symbolon/seal";
import {
  paymentsBeancount,
  paymentsCsv,
  reconcile,
  resolveTokenSymbol,
  syncVault,
  type Mismatch,
} from "@symbolon/core";
import {
  businesses,
  chainEvents,
  decisions,
  deliveries,
  invoices,
  purchaseOrders,
  seals,
  syncCursors,
  type Database,
} from "@symbolon/db";
import { symbolonContracts, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import type { PublicClient, ReadContractParameters } from "viem";
import { ensureVaultBlock } from "./business";
import { requireMember } from "./access";
import { syncToHead } from "./sync";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

export interface AccountingPayment {
  date: string;
  vendor: string;
  invoice: string;
  fp: string;
  po: string;
  delivery: string;
  amount: string;
  credit: string;
  token: string;
  tx: string;
  decision?: string;
}

export interface AccountingExportRecord {
  id: string;
  format: string;
  sha256: string;
  createdAt: string;
  rowCount?: number;
}

export interface AccountingViewData {
  business: {
    id: string;
    name: string;
    vault: string | null;
    vaultBlock: string | null;
  };
  payments: AccountingPayment[];
  totals: {
    usdcTotal: string;
    eurcTotal: string;
  };
  reconciliation: {
    status: "matched" | "mismatched" | "unavailable";
    reason?: string;
    comparedBlock: string;
    syncedBlock: string;
    totalCompared: number;
    mismatches: Mismatch[];
  };
  recentExports: AccountingExportRecord[];
}

export async function loadAccounting(
  db: Database,
  contracts: SymbolonContracts,
  client: PublicClient | undefined,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  opts: { from?: string; to?: string } = {},
): Promise<AccountingViewData> {
  await requireMember(db, user.id, businessId);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw new AuthError(404, "Business not found");

  const vault = biz.vault?.toLowerCase() ?? "";

  // 1. Invoices & Seals
  const bizInvoices = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const byFp = new Map(bizInvoices.map((i) => [i.fingerprint.toLowerCase(), i]));

  const sealsList = await db.select().from(seals);
  const sealMap = new Map(sealsList.map((s) => [s.address.toLowerCase(), s.displayName || s.handle || s.address]));

  const poList = await db.select().from(purchaseOrders).where(eq(purchaseOrders.businessId, businessId));
  const poMap = new Map(poList.map((po) => [po.poRef.toLowerCase(), po.poNumber]));

  const delList = await db.select().from(deliveries).where(eq(deliveries.businessId, businessId));
  const delMap = new Map(delList.map((d) => [d.fingerprint.toLowerCase(), d]));

  // Decision hashes from Paid events on vault
  const decisionHashMap = new Map<string, string>();
  if (vault) {
    const paidEvents = await db
      .select()
      .from(chainEvents)
      .where(and(eq(chainEvents.address, vault), eq(chainEvents.eventName, "Paid")));
    for (const pe of paidEvents) {
      const a = pe.args as { fingerprint?: string; decisionHash?: string };
      if (a.fingerprint && a.decisionHash) {
        decisionHashMap.set(`${pe.txHash.toLowerCase()}:${a.fingerprint.toLowerCase()}`, a.decisionHash);
      }
    }
  }

  // 2. Settled Events for business invoices
  const conditions = [eq(chainEvents.eventName, "Settled")];
  if (opts.from) conditions.push(gte(chainEvents.blockTime, new Date(opts.from)));
  if (opts.to) conditions.push(lte(chainEvents.blockTime, new Date(opts.to)));

  const settledEvents = (await db.select().from(chainEvents).where(and(...conditions))).filter((e) =>
    byFp.has(String((e.args as { fingerprint?: string }).fingerprint).toLowerCase()) && e.chainId === deployment.chainId && e.address.toLowerCase() === deployment.contracts.invoiceLedger.toLowerCase(),
  );
  settledEvents.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));

  let usdcSum = 0n;
  let eurcSum = 0n;

  const payments: AccountingPayment[] = settledEvents.map((e) => {
    const a = e.args as Record<string, string | number>;
    const inv = byFp.get(String(a.fingerprint).toLowerCase())!;
    const vendorName = sealMap.get(inv.seal.toLowerCase()) || inv.seal;
    const poNumber = inv.poRef ? poMap.get(inv.poRef.toLowerCase()) ?? "—" : "—";
    const delivery = delMap.get(inv.fingerprint.toLowerCase());
    const deliveryStr = delivery
      ? delivery.state === "confirmed"
        ? "Confirmed"
        : delivery.state === "rejected"
          ? "Rejected"
          : "Pending"
      : inv.poRef
        ? "Pending"
        : "Not required";

    const paidBig = BigInt(a.paid ?? 0);
    const creditBig = BigInt(a.credit ?? 0);
    const tokenSymbol = resolveTokenSymbol(inv.token, inv.chainId);

    if (tokenSymbol === "EURC") {
      eurcSum += paidBig;
    } else if (tokenSymbol === "USDC") {
      usdcSum += paidBig;
    }

    const dateStr = e.blockTime
      ? e.blockTime.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
      : "Pending";

    return {
      date: dateStr,
      vendor: vendorName,
      invoice: inv.invoiceNumber,
      fp: `${inv.fingerprint.slice(0, 6)}…${inv.fingerprint.slice(-4)}`,
      po: poNumber,
      delivery: deliveryStr,
      amount: tokenSymbol === "UNKNOWN" ? paidBig.toString() : formatAmount(paidBig, 6),
      credit: tokenSymbol === "UNKNOWN" ? creditBig.toString() : formatAmount(creditBig, 6),
      token: tokenSymbol,
      tx: e.txHash,
      decision: decisionHashMap.get(`${e.txHash.toLowerCase()}:${inv.fingerprint.toLowerCase()}`),
    };
  });

  // 3. Reconciliation against the ledger (Flow 11, K17)
  const ledgerKey = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, ledgerKey));
  const syncedBlock = cursor ? cursor.block.toString() : "unknown";
  let comparison: AccountingViewData["reconciliation"] = { status: "unavailable", reason: "Ledger comparison could not be completed.", comparedBlock: "unknown", syncedBlock, totalCompared: 0, mismatches: [] };
  try {
    const block = client ? await client.getBlockNumber() : undefined;
    const pinned = client && block !== undefined ? symbolonContracts({ ...client,
      readContract: ((args: ReadContractParameters) => (client.readContract as (params: ReadContractParameters) => Promise<unknown>)({ ...args, blockNumber: block })) as PublicClient["readContract"],
    } as PublicClient, deployment) : contracts;
    const mismatches = await reconcile(db, pinned, businessId);
    comparison = { status: mismatches.length ? "mismatched" : "matched", comparedBlock: block?.toString() ?? "unknown", syncedBlock, totalCompared: bizInvoices.length, mismatches };
  } catch {
    // The view and export both retain an explicit unavailable comparison.
  }


  // 4. Past export records (K19)
  const exportDecisions = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.kind, "export_created")))
    .orderBy(desc(decisions.createdAt))
    .limit(10);

  const recentExports: AccountingExportRecord[] = exportDecisions.map((d) => {
    const rec = d.record as Record<string, unknown> | null;
    return {
      id: d.id,
      format: String(rec?.format ?? "csv"),
      sha256: d.subject ?? "",
      createdAt: d.createdAt.toISOString(),
      rowCount: rec?.rowCount ? Number(rec.rowCount) : undefined,
    };
  });

  return {
    business: {
      id: biz.id,
      name: biz.name,
      vault: biz.vault,
      vaultBlock: biz.vaultBlock ? biz.vaultBlock.toString() : null,
    },
    payments,
    totals: {
      usdcTotal: formatAmount(usdcSum, 6),
      eurcTotal: formatAmount(eurcSum, 6),
    },
    reconciliation: comparison,
    recentExports,
  };
}

export async function exportAccounting(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  format: "csv" | "beancount",
  opts: { from?: string; to?: string } = {},
): Promise<{ content: string; filename: string; sha256: string }> {
  await requireMember(db, user.id, businessId);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw new AuthError(404, "Business not found");

  const fromDate = opts.from ? new Date(opts.from) : undefined;
  const toDate = opts.to ? new Date(opts.to) : undefined;

  const bizInvoices = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const [check] = await db.select().from(decisions).where(and(eq(decisions.businessId, businessId), eq(decisions.kind, "accounting_reconciliation"))).orderBy(desc(decisions.createdAt)).limit(1);
  const saved = (check?.record as { inputs?: { comparison?: AccountingViewData["reconciliation"]; invoiceDigest?: string } } | undefined)?.inputs;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, `ledger:${biz.chainId}:${bizInvoices[0]?.ledger.toLowerCase() ?? ""}`));
  const comparison = saved?.comparison && saved.invoiceDigest === accountingInvoiceDigest(bizInvoices)
    && (!cursor || cursor.block.toString() === saved.comparison.syncedBlock)
    ? saved.comparison : { status: "unavailable", comparedBlock: "unknown", syncedBlock: cursor?.block.toString() ?? "unknown", totalCompared: 0, mismatches: [] };
  const warning = comparison.status === "unavailable"
    ? `UNRECONCILED: comparison unavailable; ledger copy block ${comparison.syncedBlock}`
    : comparison.status === "mismatched"
      ? `UNRECONCILED: ${comparison.mismatches.length} mismatches at block ${comparison.comparedBlock ?? "unknown"}`
      : `RECONCILED: ${comparison.totalCompared} invoices at block ${comparison.comparedBlock ?? "unknown"}; ledger copy block ${comparison.syncedBlock}`;
  let content: string;
  if (format === "beancount") {
    content = await paymentsBeancount(db, businessId, { fromDate, toDate });
  } else {
    content = await paymentsCsv(db, businessId, { fromDate, toDate });
  }

  content = `${format === "csv" ? "#" : ";"} ${warning}\n${content}`;
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  const slug = biz.name.toLowerCase().replace(/[^a-z0-9]/g, "-") || "symbolon";
  const fromStr = opts.from ? opts.from.slice(0, 10) : "all";
  const toStr = opts.to ? opts.to.slice(0, 10) : "present";
  const ext = format === "beancount" ? "beancount" : "csv";
  const filename = `symbolon-payments-${slug}-${fromStr}-${toStr}.${ext}`;

  // Count lines for record
  const lines = content.trim().split("\n");
  const rowCount = format === "csv" ? Math.max(0, lines.filter(l => !l.startsWith("#")).length - 1) : lines.filter((l) => l.includes(" * ")).length;

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "export_created",
      subject: sha256,
      actor: user.id,
      inputs: { format, sha256, rowCount, from: opts.from, to: opts.to, reconciled: comparison },
      rule: "member exported accounting payments ledger",
      outcome: "exported",
    },
  );

  return { content, filename, sha256 };
}

export async function resyncLedger(
  db: Database,
  client: PublicClient,
  contracts: SymbolonContracts,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<{ syncedBlock: string; mismatches: Mismatch[] }> {
  await requireMember(db, user.id, businessId, "owner", "approver");

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz) throw new AuthError(404, "Business not found");

  // Comparing with a partly copied ledger would report mismatches that aren't there: wait for the copy or say it isn't ready
  const caughtUp = await syncToHead(db, client, { chainId: deployment.chainId, deployment }, { contracts });
  if (!caughtUp.ok) throw new AuthError(503, caughtUp.reason);

  if (biz.vault) {
    await syncVault(db, client, deployment, biz.vault as `0x${string}`, { fromBlock: await ensureVaultBlock(db, client, deployment, businessId, biz.vault) });
  }

  // Bind the durable comparison and digest to one database snapshot, even if intake/sync runs concurrently.
  return db.transaction(async (tx) => {
    const data = await loadAccounting(tx as unknown as Database, contracts, client, deployment, user, businessId);
    const comparison = data.reconciliation;
    const rows = await tx.select().from(invoices).where(eq(invoices.businessId, businessId));
    await appendAppDecision(tx, businessId, { kind: "accounting_reconciliation", subject: businessId, actor: user.id,
      inputs: { comparison, invoiceDigest: accountingInvoiceDigest(rows) }, rule: "compare the business invoice copy with the ledger after an explicit re-sync", outcome: comparison.status });
    return { syncedBlock: comparison.syncedBlock, mismatches: comparison.mismatches };
  }, { isolationLevel: "repeatable read" });

}

function accountingInvoiceDigest(rows: (typeof invoices.$inferSelect)[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.fingerprint, r.credited.toString(), r.status, r.total.toString(), r.token, r.ledger, r.chainId.toString(), r.invoiceNumber, r.poRef ?? ""]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex");
}
