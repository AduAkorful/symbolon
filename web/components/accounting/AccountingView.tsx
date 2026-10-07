"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { AccountingViewData } from "@/lib/server/accounting";
import { TxLink } from "@/components/TxLink";
import { formatDateTime, showMoney } from "@/lib/format";

export function AccountingView({
  initialData,
  businessId,
  explorer,
}: {
  initialData: AccountingViewData;
  businessId: string;
  explorer: string;
}) {
  const [data, setData] = useState<AccountingViewData>(initialData);
  const [isResyncing, startResync] = useTransition();
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [lastExportHash, setLastExportHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResync = () => {
    setError(null);
    startResync(async () => {
      try {
        const res = await fetch(`/api/business/${businessId}/accounting`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resync" }),
        });
        if (res.ok) {
          const fresh = await fetch(`/api/business/${businessId}/accounting`);
          if (fresh.ok) {
            const freshJson = await fresh.json();
            if (freshJson.data) setData(freshJson.data);
          }
        } else {
          const err = await res.json();
          setError(err.error || "Failed to resync with the ledger.");
        }
      } catch {
        setError("Network error while communicating with the ledger.");
      }
    });
  };

  const handleExport = async (format: "csv" | "beancount") => {
    setError(null);
    setIsExporting(format);
    try {
      const res = await fetch(`/api/business/${businessId}/accounting?export=${format}`);
      if (!res.ok) {
        throw new Error("Export failed");
      }
      const sha256 = res.headers.get("X-Export-Sha256");
      if (sha256) setLastExportHash(sha256);

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = `symbolon-payments.${format === "beancount" ? "beancount" : "csv"}`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // Refresh export history
      const fresh = await fetch(`/api/business/${businessId}/accounting`);
      if (fresh.ok) {
        const freshJson = await fresh.json();
        if (freshJson.data) setData(freshJson.data);
      }
    } catch {
      setError(`Failed to download ${format} export.`);
    } finally {
      setIsExporting(null);
    }
  };

  const unavailable = data.reconciliation.status === "unavailable";
  const hasMismatches = data.reconciliation.mismatches.length > 0;

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Accounting</h1>
          <p className="mt-2 max-w-[68ch] text-sm text-graphite">
            Every payment exports with its invoice fingerprint, order, delivery, transaction, and decision record. A payment in a currency we do not recognise shows its amount without a currency and is left out of the totals.
            The Vault is the bank, so the books reconcile to the chain line by line. Re-sync records the comparison used by exports; otherwise exports remain unverified.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isExporting !== null}
            onClick={() => handleExport("csv")}
            className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs md:text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
          >
            {isExporting === "csv" ? "Exporting CSV…" : "Export CSV"}
          </button>
          <button
            type="button"
            disabled={isExporting !== null}
            onClick={() => handleExport("beancount")}
            className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs md:text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
          >
            {isExporting === "beancount" ? "Exporting Beancount…" : "Export Beancount"}
          </button>
        </div>
      </div>

      {lastExportHash ? (
        <div className="mt-4 rounded-sm border border-rule bg-paper-soft p-3 text-xs">
          <span className="font-medium text-ink">Last Export Integrity (SHA-256): </span>
          <span className="font-mono text-graphite">{lastExportHash}</span>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-sm border border-red/40 bg-red/10 p-3 text-xs text-red">
          {error}
        </div>
      ) : null}

      {/* Ledger Reconciliation Card (Flow 11, K17) */}
      <section
        aria-labelledby="rec-heading"
        className={`mt-8 rounded-sm border p-5 transition-colors ${
          hasMismatches || unavailable ? "border-red/60 bg-red/5" : "border-seal/40 bg-paper"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="rec-heading" className="font-display text-xl text-ink">
              Ledger Reconciliation
            </h2>
            <p className="mt-1 text-xs text-graphite">
              Ledger copy through block <span className="font-mono">{data.reconciliation.syncedBlock}</span> · Comparison block <span className="font-mono">{data.reconciliation.comparedBlock}</span> ·{" "}
              {data.reconciliation.totalCompared} invoices compared ·{" "}
              {unavailable ? "Ledger comparison unavailable. Re-sync to retry." : hasMismatches
                ? `${data.reconciliation.mismatches.length} mismatch(es) found`
                : "Every line matches"}
            </p>
          </div>

          <button
            type="button"
            onClick={handleResync}
            disabled={isResyncing}
            className="rounded-sm border border-rule bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:border-ink disabled:opacity-50"
          >
            {isResyncing ? "Syncing ledger…" : "Re-sync ledger"}
          </button>
        </div>

        {hasMismatches ? (
          <div className="mt-4 border-t border-red/20 pt-4">
            <p className="text-xs font-medium text-red">
              The ledger is right. Symbolon&apos;s copy differs — this is a fault in Symbolon; nothing was changed onchain.
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              {data.reconciliation.mismatches.map((m, idx) => (
                <li key={idx} className="rounded border border-red/30 bg-paper p-2 font-mono">
                  <div>
                    Invoice {m.invoiceNumber} ({m.fingerprint.slice(0, 10)}…) — field &quot;{m.field}&quot;
                  </div>
                  <div className="text-graphite">
                    Database: <span className="text-red">{m.database}</span> | Ledger:{" "}
                    <span className="text-seal">{m.ledger}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : unavailable ? (
          <p className="mt-3 text-xs text-red">Cannot confirm whether the stored payments match the ledger. Exports include this warning.</p>
        ) : (
          <p className="mt-3 text-xs text-seal font-medium">
            ✓ 0 mismatches. All stored payments and statuses match the canonical ledger exactly.
          </p>
        )}
      </section>

      {/* Totals Summary Cards (K14: per-token only, never cross-token) */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-sm border border-rule p-4">
          <span className="text-xs text-graphite uppercase tracking-wider">Settled USDC Volume</span>
          <div className="mt-1 font-mono text-2xl font-medium text-ink">
            {showMoney(data.totals.usdcTotal, "USDC")}
          </div>
        </div>

        <div className="rounded-sm border border-rule p-4">
          <span className="text-xs text-graphite uppercase tracking-wider">Settled EURC Volume</span>
          <div className="mt-1 font-mono text-2xl font-medium text-ink">
            {showMoney(data.totals.eurcTotal, "EURC")}
          </div>
        </div>
      </div>

      {/* Payments List Table (K14) */}
      <section aria-labelledby="payments-heading" className="mt-10">
        <h2 id="payments-heading" className="font-display text-2xl md:text-3xl text-ink">
          Settled Payments
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] border-t border-ink text-sm">
            <thead>
              <tr className="text-left text-xs text-graphite">
                <th className="py-3 pr-4 font-normal">Date</th>
                <th className="py-3 pr-4 font-normal">Vendor</th>
                <th className="py-3 pr-4 font-normal">Invoice</th>
                <th className="py-3 pr-4 font-normal">Fingerprint</th>
                <th className="py-3 pr-4 font-normal">Order</th>
                <th className="py-3 pr-4 font-normal">Delivery</th>
                <th className="py-3 pr-4 font-normal text-right">Amount</th>
                <th className="py-3 pr-4 font-normal">Transaction</th>
                <th className="py-3 pr-4 font-normal">Record</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p, idx) => (
                <tr key={idx} className="border-t border-rule">
                  <td className="py-3 pr-4 font-mono text-xs">{p.date}</td>
                  <td className="pr-4 font-medium">{p.vendor}</td>
                  <td className="pr-4 font-mono text-xs">{p.invoice}</td>
                  <td className="pr-4 font-mono text-xs text-graphite">{p.fp}</td>
                  <td className="pr-4 text-xs font-mono">{p.po}</td>
                  <td className="pr-4 text-xs text-graphite">{p.delivery}</td>
                  <td className="pr-4 text-right font-mono text-xs tabular-nums font-medium">
                    {p.token === "UNKNOWN" ? `${p.amount} (currency unavailable)` : showMoney(p.amount, p.token)}
                  </td>
                  <td className="pr-4">
                    <TxLink
                      href={`${explorer}/tx/${p.tx}`}
                      label={`Transaction ${p.tx}`}
                      className="text-graphite hover:text-ink"
                    >
                      {`${p.tx.slice(0, 6)}…${p.tx.slice(-4)}`}
                    </TxLink>
                  </td>
                  <td className="pr-4 text-xs">
                    {p.decision ? (
                      <Link
                        href={`/business/decisions/${p.decision}`}
                        className="underline decoration-rule underline-offset-4 hover:decoration-ink"
                      >
                        Record
                      </Link>
                    ) : (
                      <span className="text-graphite">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!data.payments.length ? (
            <div className="border-t border-rule p-8 text-center text-sm text-graphite">
              No settled payments recorded for this business yet.
            </div>
          ) : null}
        </div>
      </section>

      {/* Export Records (K19) */}
      {data.recentExports.length > 0 ? (
        <section aria-labelledby="exports-heading" className="mt-12">
          <h2 id="exports-heading" className="font-display text-xl text-ink">
            Export Records
          </h2>
          <p className="mt-1 text-xs text-graphite">
            Every export is registered as an unalterable decision record with the file&apos;s SHA-256 hash.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-t border-rule text-xs">
              <thead>
                <tr className="text-left text-graphite">
                  <th className="py-2 pr-4 font-normal">Format</th>
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 font-normal">Entries</th>
                  <th className="py-2 pr-4 font-normal">SHA-256 Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {data.recentExports.map((exp) => (
                  <tr key={exp.id} className="border-t border-rule">
                    <td className="py-2 pr-4 font-medium uppercase">{exp.format}</td>
                    <td className="pr-4 font-mono text-graphite">
                      {formatDateTime(exp.createdAt)}
                    </td>
                    <td className="pr-4">{exp.rowCount ?? "—"}</td>
                    <td className="pr-4 font-mono text-graphite">{exp.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Connectors section (spec §7.8: no fake connects) */}
      <section aria-labelledby="connect-heading" className="mt-12">
        <h2 id="connect-heading" className="font-display text-xl text-ink">
          Connect your books
        </h2>
        <p className="mt-1 text-xs text-graphite">
          Direct accounting integrations are in development. Exports can be imported into your ledger today.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["Xero", "QuickBooks", "Odoo", "ERPNext"].map((connector) => (
            <li key={connector} className="rounded-sm border border-rule bg-paper p-3">
              <span className="text-sm font-medium text-ink">{connector}</span>
              <span className="mt-1 block text-[11px] text-graphite">Not available yet</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
