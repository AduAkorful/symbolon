import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { formatAmount } from "@symbolon/seal";
import {
  paymentsBeancount,
  paymentsCsv,
  reconcile,
  resolveTokenSymbol,
  syncLedger,
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
import type { Deployment, SymbolonContracts } from "@symbolon/chain";
import type { PublicClient } from "viem";
import { requireMember } from "./access";
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
        decisionHashMap.set(a.fingerprint.toLowerCase(), a.decisionHash);
      }
    }
  }

  // 2. Settled Events for business invoices
  const conditions = [eq(chainEvents.eventName, "Settled")];
  if (opts.from) conditions.push(gte(chainEvents.blockTime, new Date(opts.from)));
  if (opts.to) conditions.push(lte(chainEvents.blockTime, new Date(opts.to)));

  const settledEvents = (await db.select().from(chainEvents).where(and(...conditions))).filter((e) =>
    byFp.has(String((e.args as { fingerprint?: string }).fingerprint).toLowerCase()),
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
    const tokenSymbol = resolveTokenSymbol(inv.token);

    if (tokenSymbol === "EURC") {
      eurcSum += paidBig;
    } else {
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
      amount: formatAmount(paidBig, 6),
      credit: formatAmount(creditBig, 6),
      token: tokenSymbol,
      tx: e.txHash,
      decision: decisionHashMap.get(inv.fingerprint.toLowerCase()),
    };
  });

  // 3. Reconciliation against the ledger (Flow 11, K17)
  let mismatches: Mismatch[] = [];
  try {
    mismatches = await reconcile(db, contracts, businessId);
  } catch {
    // If chain read unavailable, leave empty
  }

  // Get current synced ledger block
  const ledgerKey = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, ledgerKey));
  const syncedBlock = cursor ? cursor.block.toString() : deployment.startBlock.toString();

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
    reconciliation: {
      syncedBlock,
      totalCompared: bizInvoices.length,
      mismatches,
    },
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

  let content: string;
  if (format === "beancount") {
    content = await paymentsBeancount(db, businessId, { fromDate, toDate });
  } else {
    content = await paymentsCsv(db, businessId, { fromDate, toDate });
  }

  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  const slug = biz.name.toLowerCase().replace(/[^a-z0-9]/g, "-") || "symbolon";
  const fromStr = opts.from ? opts.from.slice(0, 10) : "all";
  const toStr = opts.to ? opts.to.slice(0, 10) : "present";
  const ext = format === "beancount" ? "beancount" : "csv";
  const filename = `symbolon-payments-${slug}-${fromStr}-${toStr}.${ext}`;

  // Count lines for record
  const lines = content.trim().split("\n");
  const rowCount = format === "csv" ? Math.max(0, lines.length - 1) : lines.filter((l) => l.includes(" * ")).length;

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "export_created",
      subject: sha256,
      actor: user.id,
      inputs: { format, sha256, rowCount, from: opts.from, to: opts.to },
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

  await syncLedger(db, client, contracts, deployment);

  if (biz.vault) {
    await syncVault(db, client, deployment, biz.vault as `0x${string}`);
  }

  const mismatches = await reconcile(db, contracts, businessId);

  const ledgerKey = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
  const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, ledgerKey));
  const syncedBlock = cursor ? cursor.block.toString() : deployment.startBlock.toString();

  return { syncedBlock, mismatches };
}
