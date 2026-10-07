"use client";

import Link from "next/link";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import type { OfferDisplay } from "@/lib/server/offers";
import { formatDay, formatDateTime } from "@/lib/format";

interface InvoiceSummary {
  fingerprint: string;
  invoiceNumber: string;
  clientName: string;
  total: string;
  credited: string;
  currencySymbol: string;
  decimals: number;
  dueDate: string;
  dueDays: number;
}

interface Props {
  invoice: InvoiceSummary;
  offers: OfferDisplay[];
  suggested: { discountBps: number; discountPercent: string } | null;
  signer: SignerPlan;
}

const DURATIONS = [
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 3 * 86400 },
  { label: "7 days", seconds: 7 * 86400 },
];

export function EarlyPayClient({ invoice, offers: initialOffers, suggested, signer }: Props) {
  const discover = useWalletProviders();
  const [offers, setOffers] = useState<OfferDisplay[]>(initialOffers);
  const [pct, setPct] = useState<number>(suggested ? Number(suggested.discountPercent) : 1.5);
  const [durationSecs, setDurationSecs] = useState<number>(3 * 86400);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingRaw = BigInt(invoice.total) - BigInt(invoice.credited);
  const remainingFloat = Number(remainingRaw) / 10 ** invoice.decimals;
  const discountBps = Math.round(pct * 100);
  const receiveFloat = remainingFloat * (1 - pct / 100);
  const savingFloat = remainingFloat - receiveFloat;

  const openOffer = offers.find((o) => o.status === "open");
  const counterOffer = offers.find((o) => o.status === "countered");
  const latestTaken = offers.find((o) => o.status === "taken");

  async function reloadOffers() {
    try {
      const res = await fetch(`/api/vendor/offers?fingerprint=${invoice.fingerprint}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setOffers(data.offers);
    } catch {
      setError("Couldn't refresh the offers. What's shown may be out of date; reload the page.");
    }
  }

  async function handleSignOffer(targetDiscountBps = discountBps, targetDuration = durationSecs, counterId?: string) {
    setError(null);
    setBusy(true);
    try {
      // 1. Prepare
      const prepRes = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          fingerprint: invoice.fingerprint,
          discountBps: targetDiscountBps,
          durationSeconds: targetDuration,
          counterId,
        }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare offer");

      // 2. Sign
      const signature = await signTypedData(signer, prepData.typedData, discover);

      // 3. Submit
      const subRes = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          fingerprint: invoice.fingerprint,
          discountBps: targetDiscountBps,
          validUntil: prepData.validUntil,
          signature,
          counterId,
        }),
      });
      const subData = await subRes.json();
      if (!subRes.ok) throw new Error(subData.error || "Failed to submit offer");

      setSigning(false);
      await reloadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw(offerId: string) {
    if (!confirm("Withdraw this Early Pay offer?")) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw", offerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to withdraw offer");
      await reloadOffers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-24">
      <p className="text-sm text-graphite">
        <Link href={`/vendor/invoices/${invoice.fingerprint}`} className="hover:text-ink">
          Invoice {invoice.invoiceNumber}
        </Link>
        <span className="mx-1.5">/</span> Early Pay
      </p>

      <h1 className="mt-3 font-display text-4xl leading-none">Get paid early</h1>
      <p className="mt-3 max-w-[60ch] text-graphite">
        {invoice.clientName} owes {invoice.currencySymbol} {remainingFloat.toFixed(2)} due on {invoice.dueDate} ({invoice.dueDays} days from now).
        Offer a discount, signed by your Seal. Their Steward or team reviews it and can release payment early.
      </p>

      {error ? (
        <div role="alert" className="mt-6 rounded-doc border border-red/40 bg-red-wash p-4 text-sm text-red">
          {error}
        </div>
      ) : null}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Left Column: Offer Form / Controls */}
        <section aria-labelledby="offer-controls" className="space-y-6">
          <div className="rounded-doc border border-rule bg-paper p-6">
            <h2 id="offer-controls" className="font-display text-2xl">
              Discount you offer
            </h2>

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="discount-range" className="text-graphite">
                  Discount rate
                </label>
                <span className="font-mono text-base font-semibold">{pct.toFixed(2)}%</span>
              </div>
              <input
                id="discount-range"
                type="range"
                min={0.25}
                max={5.0}
                step={0.05}
                value={pct}
                disabled={busy || !!openOffer}
                onChange={(e) => setPct(Number(e.target.value))}
                className="mt-2 w-full accent-ink"
              />
              <div className="mt-1 flex justify-between text-xs text-graphite">
                <span>0.25%</span>
                <span>2.5%</span>
                <span>5.0%</span>
              </div>
            </div>

            {suggested ? (
              <p className="mt-3 text-xs text-seal">
                Previous accepted discount: {suggested.discountPercent}%
              </p>
            ) : (
              <p className="mt-3 text-xs text-graphite">
                No previous Early Pay history with this client.
              </p>
            )}

            <div className="mt-6 border-t border-rule pt-4">
              <label className="block text-xs font-medium uppercase tracking-wider text-graphite">
                Offer valid for
              </label>
              <div className="mt-2 flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.seconds}
                    type="button"
                    disabled={busy || !!openOffer}
                    onClick={() => setDurationSecs(d.seconds)}
                    className={`rounded-doc px-3 py-1.5 text-xs font-medium transition-colors ${
                      durationSecs === d.seconds
                        ? "bg-ink text-paper"
                        : "border border-rule hover:border-ink text-ink"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-sm bg-rule-soft/40 p-4">
              <p className="text-xs uppercase tracking-wider text-graphite">You receive upon settlement</p>
              <p className="mt-1 font-display text-5xl leading-none tabular-nums text-ink">
                {invoice.currencySymbol} {receiveFloat.toFixed(2)}
              </p>
              <p className="mt-2 text-xs text-graphite">
                {pct.toFixed(2)}% off total · payer saves {invoice.currencySymbol} {savingFloat.toFixed(2)}
              </p>
            </div>

            {!openOffer && !latestTaken ? (
              <button
                type="button"
                onClick={() => setSigning(true)}
                disabled={busy}
                className="mt-6 w-full rounded-doc bg-ink py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Sign this offer
              </button>
            ) : null}
          </div>
        </section>

        {/* Right Column: Status & History */}
        <section aria-labelledby="status-header" className="space-y-6">
          <h2 id="status-header" className="font-display text-2xl">
            Offer status
          </h2>

          {latestTaken ? (
            <div className="rounded-doc border border-seal/50 bg-seal/5 p-6">
              <span className="font-mono text-xs uppercase tracking-wider text-seal font-medium">
                Payment Released
              </span>
              <p className="mt-2 text-lg font-medium">Early Pay was accepted!</p>
              <p className="mt-1 text-sm text-graphite">
                This invoice has settled onchain with a discount of {latestTaken.discountPercent}%.
              </p>
              <Link
                href={`/receipt/${invoice.fingerprint}`}
                className="mt-4 inline-block font-medium text-seal underline decoration-seal/40 underline-offset-4 hover:text-ink text-sm"
              >
                View settlement receipt →
              </Link>
            </div>
          ) : counterOffer ? (
            <div className="rounded-doc border border-seal/60 bg-paper-raised p-6 shadow-sm">
              <span className="font-mono text-xs uppercase tracking-wider text-seal font-medium">
                Counter-Offer Received
              </span>
              <p className="mt-2 text-xl font-medium">
                {invoice.clientName} proposed {counterOffer.discountPercent}%
              </p>
              <p className="mt-2 text-sm text-graphite">
                Their Steward proposed {counterOffer.discountPercent}% to pay today.
                You would receive approximately {invoice.currencySymbol}{" "}
                {(remainingFloat * (1 - counterOffer.discountBps / 10000)).toFixed(2)}.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleSignOffer(counterOffer.discountBps, durationSecs, counterOffer.id)}
                  className="rounded-doc bg-ink px-4 py-2.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-50"
                >
                  Accept and sign {counterOffer.discountPercent}%
                </button>
              </div>
            </div>
          ) : openOffer ? (
            <div className="rounded-doc border border-rule bg-paper p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-seal font-medium">
                  Offer Open
                </span>
                <span className="text-xs text-graphite">
                  Expires {formatDateTime(new Date(openOffer.validUntil))}
                </span>
              </div>
              <p className="mt-2 text-xl font-medium">
                {openOffer.discountPercent}% off ({invoice.currencySymbol} {(remainingFloat * (1 - openOffer.discountBps / 10000)).toFixed(2)})
              </p>
              <p className="mt-2 text-sm text-graphite">
                Waiting for {invoice.clientName}&apos;s Steward or team to review.
                If they decline or the offer expires, you will still be paid in full on the due date.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleWithdraw(openOffer.id)}
                className="mt-4 rounded-doc border border-rule px-3 py-1.5 text-xs text-graphite hover:border-ink hover:text-ink"
              >
                Withdraw offer
              </button>
            </div>
          ) : (
            <div className="rounded-doc border border-rule/70 p-6 text-sm text-graphite">
              No active offer. Use the form to propose a cash-now discount.
            </div>
          )}

          {/* Past Offers List */}
          {offers.length > 0 ? (
            <div className="border-t border-rule pt-6">
              <h3 className="font-mono text-xs uppercase tracking-wider text-graphite">History</h3>
              <ul className="mt-4 space-y-3">
                {offers.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded-sm border border-rule/60 p-3 text-xs">
                    <div>
                      <span className="font-medium text-ink">{o.discountPercent}% discount</span>
                      <span className="ml-2 text-graphite">({formatDay(new Date(o.createdAt))})</span>
                    </div>
                    <span className="font-mono uppercase text-graphite">
                      {o.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      {/* Confirmation Modal */}
      {signing ? (
        <Overlay
          label={{ id: "sign-modal-title" }}
          onClose={() => {
            if (!busy) setSigning(false);
          }}
        >
          <div className="p-7">
            <h2 id="sign-modal-title" className="font-display text-3xl">
              Sign Early Pay Offer
            </h2>
            <p className="mt-3 text-sm text-graphite">
              You are offering <strong>{pct.toFixed(2)}% off</strong> invoice {invoice.invoiceNumber}.
              You will receive approximately <strong>{invoice.currencySymbol} {receiveFloat.toFixed(2)}</strong> if {invoice.clientName} accepts.
            </p>
            <p className="mt-3 text-xs text-graphite">
              Your wallet will prompt you to sign an EIP-712 typed data message.
              This does not grant custody or access to your keys.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSignOffer()}
                className="flex-1 rounded-doc bg-ink py-3 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Signing..." : "Sign and send"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSigning(false)}
                className="rounded-doc border border-rule px-5 py-3 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
