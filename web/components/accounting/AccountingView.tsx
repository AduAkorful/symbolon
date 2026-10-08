"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { AccountingViewData } from "@/lib/server/accounting";
import { TxLink } from "@/components/TxLink";
import { formatDateTime, showMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { DataTable } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { EmptyState } from "@/components/ui/States";
import { Eyebrow, Lead, PageTitle, SectionTitle } from "@/components/ui/Type";

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
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Accounting</PageTitle>
          <Lead className="mt-3">
            Every payment exports with its invoice fingerprint, order, delivery, transaction and decision record. The Vault is the bank, so the books reconcile to the chain line by line.
            Re-sync records the comparison the exports use; without it an export is marked unverified.
          </Lead>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={isExporting !== null} busy={isExporting === "csv"} onClick={() => handleExport("csv")}>
            {isExporting === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button variant="secondary" disabled={isExporting !== null} busy={isExporting === "beancount"} onClick={() => handleExport("beancount")}>
            {isExporting === "beancount" ? "Exporting…" : "Export Beancount"}
          </Button>
        </div>
      </div>

      {lastExportHash ? (
        <Callout tone="neutral" title="Last export, SHA-256" className="mt-4">
          <span className="break-all text-graphite">{lastExportHash}</span>
        </Callout>
      ) : null}

      {error ? <Callout tone="danger" className="mt-4">{error}</Callout> : null}

      {/* Reconciliation with the ledger (Flow 11, K17) */}
      <section aria-labelledby="rec-heading" className={`mt-8 rounded-doc border px-5 py-5 ${hasMismatches || unavailable ? "border-red/50 bg-red-wash" : "border-rule"}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <SectionTitle id="rec-heading">Ledger reconciliation</SectionTitle>
            <p className="mt-1 text-sm text-graphite">
              Copy through block {data.reconciliation.syncedBlock} · compared at block {data.reconciliation.comparedBlock} · {data.reconciliation.totalCompared} invoices compared ·{" "}
              {unavailable ? "the comparison is unavailable; re-sync to retry" : hasMismatches ? `${data.reconciliation.mismatches.length} ${data.reconciliation.mismatches.length === 1 ? "mismatch" : "mismatches"} found` : "every line matches"}
            </p>
          </div>
          <Button variant="secondary" busy={isResyncing} onClick={handleResync}>
            {isResyncing ? "Syncing…" : "Re-sync with the ledger"}
          </Button>
        </div>

        {hasMismatches ? (
          <div className="mt-4 border-t border-red/30 pt-4">
            <p className="font-medium text-red">The ledger is right and Symbolon’s copy differs. This is a fault in Symbolon; nothing was changed onchain.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {data.reconciliation.mismatches.map((m, idx) => (
                <li key={idx} className="rounded-doc border border-red/30 bg-paper px-3 py-2">
                  <p>Invoice {m.invoiceNumber} ({m.fingerprint.slice(0, 10)}…), field “{m.field}”</p>
                  <p className="break-all text-graphite">
                    Database: <span className="text-red">{m.database}</span> · Ledger: <span className="text-seal">{m.ledger}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : unavailable ? (
          <p className="mt-3 text-sm text-red">Symbolon can’t confirm whether the stored payments match the ledger. Exports carry this warning.</p>
        ) : (
          <p className="mt-3 text-sm font-medium text-ok">✓ No mismatches. Every stored payment and status matches the ledger.</p>
        )}
      </section>

      {/* Totals, per token and never across tokens (K14) */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-doc border border-rule px-5 py-4">
          <Eyebrow as="p">Settled USDC</Eyebrow>
          <Money className="mt-1 block font-display text-3xl text-ink">{showMoney(data.totals.usdcTotal, "USDC")}</Money>
        </div>
        <div className="rounded-doc border border-rule px-5 py-4">
          <Eyebrow as="p">Settled EURC</Eyebrow>
          <Money className="mt-1 block font-display text-3xl text-ink">{showMoney(data.totals.eurcTotal, "EURC")}</Money>
        </div>
      </div>

      {/* Payments (K14) */}
      <section aria-labelledby="payments-heading" className="mt-12">
        <SectionTitle id="payments-heading">Settled payments</SectionTitle>
        {data.payments.length ? (
          <DataTable
            className="mt-4"
            caption="Settled payments"
            rows={data.payments}
            rowKey={(p, i) => `${p.tx}:${i}`}
            columns={[
              { key: "vendor", header: "Vendor", primary: true, cell: (p) => p.vendor },
              { key: "amount", header: "Amount", amount: true, cell: (p) => (p.token === "UNKNOWN" ? `${p.amount} (currency unavailable)` : showMoney(p.amount, p.token)) },
              { key: "date", header: "Date", nowrap: true, cell: (p) => p.date },
              { key: "invoice", header: "Invoice", cell: (p) => p.invoice },
              { key: "po", header: "Order", cell: (p) => p.po },
              { key: "delivery", header: "Delivery", cell: (p) => p.delivery },
              { key: "tx", header: "Transaction", nowrap: true, cell: (p) => <TxLink href={`${explorer}/tx/${p.tx}`} label={`Transaction ${p.tx}`} className="text-graphite hover:text-ink">{`${p.tx.slice(0, 6)}…${p.tx.slice(-4)}`}</TxLink> },
              { key: "record", header: "Record", cell: (p) => (p.decision ? <Link href={`/business/decisions/${p.decision}`} className="underline decoration-rule underline-offset-4 hover:decoration-ink">Decision</Link> : <span className="text-graphite">—</span>) },
            ]}
          />
        ) : (
          <EmptyState title="No settled payments yet" className="mt-4">Payments the Vault makes on Arc appear here with their invoice and decision record.</EmptyState>
        )}
      </section>

      {/* Exports (K19) */}
      {data.recentExports.length > 0 ? (
        <section aria-labelledby="exports-heading" className="mt-12">
          <SectionTitle id="exports-heading">Exports</SectionTitle>
          <p className="mt-1 text-sm text-graphite">Each export is registered as a decision record with the file’s SHA-256 hash.</p>
          <DataTable
            className="mt-4"
            caption="Exports"
            rows={data.recentExports}
            rowKey={(e) => e.id}
            columns={[
              { key: "format", header: "Format", primary: true, cell: (e) => <span className="uppercase">{e.format}</span> },
              { key: "date", header: "Date", nowrap: true, cell: (e) => formatDateTime(e.createdAt) },
              { key: "rows", header: "Entries", cell: (e) => e.rowCount ?? "—" },
              { key: "sha", header: "SHA-256", cell: (e) => <span className="break-all text-graphite">{e.sha256}</span> },
            ]}
          />
        </section>
      ) : null}

      {/* Accounting software (spec 7.8: no fake connects) */}
      <section aria-labelledby="connect-heading" className="mt-12">
        <SectionTitle id="connect-heading">Connect your books</SectionTitle>
        <p className="mt-1 text-sm text-graphite">Direct connections are in development. Today, import an export into your accounting software.</p>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {["Xero", "QuickBooks", "Odoo", "ERPNext"].map((connector) => (
            <li key={connector} className="rounded-doc border border-rule px-4 py-3">
              <span className="font-medium text-ink">{connector}</span>
              <span className="mt-1 block text-sm text-graphite">Not available yet</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
