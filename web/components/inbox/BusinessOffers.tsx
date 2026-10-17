"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { businessOffers } from "@/lib/server/offers";
import { formatDateTime, showBps, showDate, showMoney } from "@/lib/format";
import { Eyebrow } from "@/components/ui/Type";
import { PayInvoice } from "@/components/inbox/PayInvoice";
import type { SignerPlan } from "@/components/setup/owner-signer";

type View = Awaited<ReturnType<typeof businessOffers>>;
function exact(raw: bigint) { const digits = raw.toString().padStart(7, "0"); return `${digits.slice(0, -6)}.${digits.slice(-6)}`; }

/** What became of an earlier offer, in words (QA STW-6): "Replaced: 1.5% (15 Oct, 16:40 UTC)" */
function earlierLabel(o: View["offers"][number], newestOpen: View["offers"][number] | undefined): string {
  if (o.status === "withdrawn" && newestOpen && new Date(newestOpen.createdAt) >= new Date(o.createdAt)) return "Replaced";
  const words: Record<string, string> = { withdrawn: "Withdrawn", expired: "Expired", declined: "Declined", taken: "Taken", countered: "Countered" };
  return words[o.status] ?? o.status;
}

/** `pay` turns "Accept offer" on: the same wallet payment as Pay now, with this offer's signed discount (plan 05zj C, SYM-11) */
export function BusinessOffers({ businessId, fingerprint, view, symbol, pay, terms = [] }: {
  businessId: string;
  fingerprint: string;
  view: View;
  symbol: string;
  /** The Early Pay tiers written into the sealed invoice itself (QA STW-6): listed with what became of them */
  terms?: { payBy: number | string; discountBps: number }[];
  pay?: { signer: SignerPlan; explorer: string; /** why paying isn't possible right now, if it isn't */ unavailable?: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = view.offers.filter((o) => o.status === "open" && o.signature);
  // offers that are no longer open stay on the page, so "no offer" is never said while one was made (QA STW-6)
  const earlier = view.offers.filter((o) => o.signature && !(o.status === "open"));
  const nowSec = Math.floor(Date.now() / 1000);
  const newestOpen = open[0];
  const tiers = terms.map((t) => {
    const payBy = Number(t.payBy);
    const status = payBy <= nowSec ? "Expired" : newestOpen && newestOpen.discountBps !== t.discountBps ? `Replaced by the ${showBps(newestOpen.discountBps)}% offer` : "Still in the terms";
    return { key: `${payBy}:${t.discountBps}`, text: `${showBps(t.discountBps)}% if paid by ${showDate(payBy)}`, status };
  });
  if (!open.length && !view.counter && !earlier.length && !tiers.length) return null;
  async function act(action: "decline" | "counter", offerId?: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/business/${businessId}/offers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, fingerprint, offerId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update this offer.");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update this offer."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 rounded-doc border border-rule p-4" aria-label="Vendor Early Pay offers">
    <Eyebrow as="h2">Vendor Early Pay offers</Eyebrow>
    <p className="mt-2 text-xs text-graphite">Accepting an offer pays the invoice now, with the vendor’s signed discount. The Vault’s rules still apply.</p>
    {open.map((offer) => <div key={offer.id} className="mt-3 text-sm">
      <p>{offer.discountPercent}% discount · saving {showMoney(exact(BigInt(view.remaining) * BigInt(offer.discountBps) / 10_000n), symbol)} · valid until {formatDateTime(new Date(offer.validUntil))}</p>
      {view.canAct ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {pay && !pay.unavailable ? (
            <PayInvoice businessId={businessId} fingerprint={fingerprint} label="Accept offer" size="sm"
              offer={{ discountBps: offer.discountBps, validUntil: offer.validUntilEpoch }} signer={pay.signer} explorer={pay.explorer} />
          ) : null}
          <button disabled={busy} className="underline" onClick={() => act("decline", offer.id)}>Decline offer</button>
        </div>
      ) : null}
      {view.canAct && pay?.unavailable ? <p className="mt-1 text-xs text-graphite">{pay.unavailable}</p> : null}
    </div>)}
    {!open.length && (earlier.length || tiers.length) ? <p className="mt-3 text-sm text-graphite">No offer is open right now.</p> : null}
    {earlier.length ? (
      <div className="mt-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-graphite">Earlier offers</p>
        <ul className="mt-1 space-y-1 text-graphite">
          {earlier.map((o) => <li key={o.id}>{earlierLabel(o, newestOpen)}: {showBps(o.discountBps)}% ({formatDateTime(new Date(o.createdAt))})</li>)}
        </ul>
      </div>
    ) : null}
    {tiers.length ? (
      <div className="mt-3 text-sm">
        <p className="text-xs uppercase tracking-wide text-graphite">In the invoice’s own terms</p>
        <ul className="mt-1 space-y-1 text-graphite">
          {tiers.map((t) => <li key={t.key}>{t.text} · {t.status}</li>)}
        </ul>
      </div>
    ) : null}
    {view.counter ? <div className="mt-3 text-sm"><p>Steward recommends requesting {(view.counter.discountBps / 100).toFixed(2)}%. The vendor must sign fresh terms before payment.</p>
      {view.canAct ? <button disabled={busy} className="mt-2 underline" onClick={() => act("counter")}>Send this counter</button> : null}</div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red">{error}</p> : null}
  </section>;
}
