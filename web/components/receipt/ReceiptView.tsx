"use client";

import Link from "next/link";
import { useState } from "react";

import { SealStamp } from "@/components/Marks";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TxLink } from "@/components/TxLink";
import type { PublicReceiptResult } from "@/lib/server/receipt";
import { formatDateTime, showMoney } from "@/lib/format";
import { Address } from "@/components/Address";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/Type";

interface Props {
  data: Extract<PublicReceiptResult, { state: "settled" }>;
  explorerUrl: string;
}

export function ReceiptView({ data, explorerUrl }: Props) {
  const [copied, setCopied] = useState(false);

  function copyLink() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function printReceipt() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <PublicHeader />

      <main className="mx-auto max-w-[780px] px-6 pb-24 pt-12 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">
            Settlement Receipt
          </p>
          <span className="rounded bg-seal/10 px-2.5 py-0.5 font-mono text-xs text-seal">
            {data.isFullyPaid ? "Fully settled on Arc ✓" : "Partially settled on Arc"}
          </span>
        </div>

        <div className="mt-4 flex items-start justify-between gap-6">
          <div>
            <h1 className="font-display text-[clamp(2.6rem,5.5vw,4.2rem)] leading-none text-ink">
              {showMoney(data.totalPaidFormatted, data.document.currency.symbol)}
            </h1>
            <p className="mt-3 text-sm text-graphite">
              Paid to {data.vendor.name} for invoice #{data.invoiceNumber}
            </p>
          </div>
          {data.vendor.handle ? (
            <SealStamp handle={data.vendor.handle} size={72} className="rotate-[-6deg]" />
          ) : null}
        </div>

        {/* Fact lines */}
        <dl className="mt-10 border-t border-ink text-sm">
          <div className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite">Vendor</dt>
            <dd className="text-ink font-medium">
              {data.vendor.name}{" "}
              {data.vendor.handle ? (
                <span className="font-mono text-xs text-graphite">({data.vendor.handle})</span>
              ) : null}
            </dd>
          </div>

          <div className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite">Invoice number</dt>
            <dd className="font-mono text-ink">{data.invoiceNumber}</dd>
          </div>

          <div className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite">Invoice fingerprint</dt>
            <dd className="font-mono text-xs break-all text-ink">{data.fingerprint}</dd>
          </div>

          <div className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite">Credit settled</dt>
            <dd className="font-mono text-ink">{showMoney(data.totalCreditFormatted, data.document.currency.symbol)}</dd>
          </div>

          <div className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
            <dt className="text-graphite">Remaining balance</dt>
            <dd className="font-mono text-ink">{showMoney(data.ledgerRemainingFormatted, data.document.currency.symbol)}</dd>
          </div>
        </dl>

        {/* Settlements list */}
        <section aria-labelledby="settlements-title" className="mt-10 space-y-4">
          <Eyebrow id="settlements-title" as="h2">
            Onchain settlements ({data.settlements.length})
          </Eyebrow>

          <div className="divide-y divide-rule-soft rounded-doc border border-rule bg-paper-raised">
            {data.settlements.map((s, idx) => (
              <div key={idx} className="p-4 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium text-ink text-sm">
                    {showMoney(s.paidFormatted, data.document.currency.symbol)}
                  </span>
                  <span className="text-graphite">
                    {s.timestamp ? formatDateTime(s.timestamp) : "Payment time unavailable"}
                  </span>
                </div>

                <div className="grid gap-1 text-graphite sm:grid-cols-2">
                  <div>
                    Payer Vault:{" "}
                    <Address value={s.payer} full className="text-ink" />
                  </div>
                  <div>
                    Payout address:{" "}
                    <Address value={s.payoutAddress} full className="text-ink" /> (domain {s.payoutDomain})
                  </div>
                </div>

                {s.discountBps > 0 ? (
                  <p className="text-seal font-medium">
                    Early Pay discount: {(s.discountBps / 100).toFixed(2)}% (signed by {data.vendor.name})
                  </p>
                ) : null}

                <div className="pt-1">
                  <TxLink
                    href={`${explorerUrl}/tx/${s.txHash}`}
                    label="View settlement transaction on Arc"
                    className="font-mono text-graphite underline hover:text-ink break-all"
                  >
                    tx: {s.txHash}
                  </TxLink>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Action buttons (hidden on print) */}
        <div className="mt-8 flex flex-wrap gap-3 print:hidden">
          <Link
            href="/verify"
            className={buttonClass()}
          >
            Check it yourself on Arc
          </Link>
          <button
            type="button"
            onClick={copyLink}
            className={buttonClass({ variant: "secondary" })}
          >
            {copied ? "Link copied ✓" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={printReceipt}
            className={buttonClass({ variant: "secondary" })}
          >
            Print receipt
          </button>
        </div>

        <p className="mt-8 text-xs text-graphite">
          Anyone with this receipt can independently verify the settlement on the Arc ledger. It does not depend on Symbolon remaining online.
        </p>
      </main>
    </div>
  );
}
