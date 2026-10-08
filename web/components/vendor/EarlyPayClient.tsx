"use client";

import Link from "next/link";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState, InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { useConfirm } from "@/components/useConfirm";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import type { OfferDisplay } from "@/lib/server/offers";
import { formatUnits } from "viem";
import { formatDay, formatDateTime, showMoney } from "@/lib/format";
import { Eyebrow, Lead, PageTitle, SectionTitle, SmallTitle } from "@/components/ui/Type";

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
  const [ask, confirmDialog] = useConfirm();
  const [offers, setOffers] = useState<OfferDisplay[]>(initialOffers);
  const [pct, setPct] = useState<number>(suggested ? Number(suggested.discountPercent) : 1.5);
  const [durationSecs, setDurationSecs] = useState<number>(3 * 86400);
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // exact integer arithmetic, the ledger's own rule (credit - credit * bps / 10000); nothing here is floating point
  const remainingRaw = BigInt(invoice.total) - BigInt(invoice.credited);
  const netOf = (bps: number) => remainingRaw - (remainingRaw * BigInt(bps)) / 10_000n;
  const money = (raw: bigint) => showMoney(formatUnits(raw, invoice.decimals), invoice.currencySymbol);
  const discountBps = Math.round(pct * 100);
  const receiveRaw = netOf(discountBps);
  const savingRaw = remainingRaw - receiveRaw;

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
    if (!(await ask({ title: "Withdraw this offer?", body: "The business can no longer accept it. You can make a new offer later.", confirmLabel: "Withdraw the offer", destructive: true }))) return;
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
      {confirmDialog}
      <p className="text-sm text-graphite">
        <Link href={`/vendor/invoices/${invoice.fingerprint}`} className="underline decoration-rule underline-offset-4 hover:text-ink">
          Invoice {invoice.invoiceNumber}
        </Link>
        <span className="mx-2">/</span>Early Pay
      </p>

      <PageTitle className="mt-3">Get paid early</PageTitle>
      <Lead className="mt-3">
        {invoice.clientName} owes {money(remainingRaw)}, due {invoice.dueDate} ({invoice.dueDays} days from now). Offer a discount signed by your Seal; their Steward or team reviews it and can pay you early.
      </Lead>

      {error ? <InlineError className="mt-6">{error}</InlineError> : null}

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-labelledby="offer-controls" className="min-w-0">
          <div className="space-y-6 rounded-doc border border-rule bg-paper-raised px-6 py-6">
            <SectionTitle id="offer-controls">Discount you offer</SectionTitle>

            <Field label={<span className="flex items-baseline justify-between"><span>Discount rate</span><span className="font-display text-2xl">{pct.toFixed(2)}%</span></span>} hint={suggested ? `Last accepted by this client: ${suggested.discountPercent}%` : "No earlier Early Pay with this client."}>
              {(a) => (
                <>
                  <input {...a} type="range" min={0.25} max={5.0} step={0.05} value={pct} disabled={busy || !!openOffer} onChange={(e) => setPct(Number(e.target.value))} className="mt-1 w-full accent-[var(--seal)]" />
                  <div className="mt-1 flex justify-between text-xs text-graphite" aria-hidden><span>0.25%</span><span>2.5%</span><span>5%</span></div>
                </>
              )}
            </Field>

            <Segmented
              label="Offer valid for"
              value={String(durationSecs)}
              disabled={busy || !!openOffer}
              options={DURATIONS.map((d) => ({ value: String(d.seconds), label: d.label }))}
              onChange={(v) => setDurationSecs(Number(v))}
            />

            <div className="rounded-doc bg-rule-soft/40 px-5 py-4">
              <Eyebrow>You receive when it settles</Eyebrow>
              <p className="mt-1 font-display text-4xl leading-none text-ink"><Money>{money(receiveRaw)}</Money></p>
              <p className="mt-2 text-sm text-graphite">{pct.toFixed(2)}% off the total · the payer saves {money(savingRaw)}</p>
            </div>

            {!openOffer && !latestTaken ? (
              <Button className="w-full" disabled={busy} onClick={() => setSigning(true)}>Sign this offer</Button>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="status-header" className="min-w-0 space-y-6">
          <SectionTitle id="status-header">Offer status</SectionTitle>

          {latestTaken ? (
            <Callout tone="ok" title="Payment released" actions={<LinkButton href={`/receipt/${invoice.fingerprint}`} variant="secondary" size="sm">View the settlement receipt</LinkButton>}>
              <p className="font-medium">Early Pay was accepted.</p>
              <p className="mt-1 text-graphite">The invoice settled onchain with a discount of {latestTaken.discountPercent}%.</p>
            </Callout>
          ) : counterOffer ? (
            <Callout
              tone="info"
              title="A counter-offer"
              actions={<Button size="sm" disabled={busy} onClick={() => handleSignOffer(counterOffer.discountBps, durationSecs, counterOffer.id)}>Accept and sign {counterOffer.discountPercent}%</Button>}
            >
              <p className="text-lg font-medium">{invoice.clientName} proposed {counterOffer.discountPercent}%</p>
              <p className="mt-1 text-graphite">Their Steward would pay today at {counterOffer.discountPercent}% off. You would receive about {money(netOf(counterOffer.discountBps))}.</p>
            </Callout>
          ) : openOffer ? (
            <Callout
              tone="neutral"
              title="Your offer is open"
              actions={<Button variant="secondary" size="sm" disabled={busy} onClick={() => handleWithdraw(openOffer.id)}>Withdraw the offer</Button>}
            >
              <p className="text-lg font-medium">{openOffer.discountPercent}% off · {money(netOf(openOffer.discountBps))}</p>
              <p className="mt-1 text-graphite">Expires {formatDateTime(new Date(openOffer.validUntil))}. Waiting for {invoice.clientName}’s Steward or team. If they decline or it expires, you are still paid in full on the due date.</p>
            </Callout>
          ) : (
            <EmptyState title="No offer yet">Use the form to propose a discount for being paid early.</EmptyState>
          )}

          {offers.length > 0 ? (
            <div className="border-t border-rule pt-6">
              <SmallTitle as="h3">History</SmallTitle>
              <ul className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
                {offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span>
                      <span className="font-medium text-ink">{o.discountPercent}% discount</span>
                      <span className="ml-2 text-graphite">{formatDay(new Date(o.createdAt))}</span>
                    </span>
                    <StatusPill tone={o.status === "taken" ? "ok" : o.status === "open" || o.status === "countered" ? "info" : "neutral"} className="capitalize">{o.status}</StatusPill>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      {/* Confirmation */}
      {signing ? (
        <Overlay
          title="Sign this Early Pay offer"
          onClose={() => {
            if (!busy) setSigning(false);
          }}
        >
          <p className="text-graphite">
            You are offering <strong className="text-ink">{pct.toFixed(2)}% off</strong> invoice {invoice.invoiceNumber}. You will receive{" "}
            <strong className="whitespace-nowrap text-ink">{money(receiveRaw)}</strong> if {invoice.clientName} accepts.
          </p>
          <p className="text-graphite">
            Your wallet will ask you to sign a message. Signing does not give anyone custody of your keys or funds.
          </p>
          <Overlay.Footer>
            <Button variant="secondary" disabled={busy} onClick={() => setSigning(false)}>Cancel</Button>
            <Button busy={busy} onClick={() => handleSignOffer()}>{busy ? "Signing…" : "Sign and send"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </div>
  );
}
