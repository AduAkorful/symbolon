"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { businessOffers } from "@/lib/server/offers";
import { formatDateTime } from "@/lib/format";
import { Eyebrow } from "@/components/ui/Type";

type View = Awaited<ReturnType<typeof businessOffers>>;
function exact(raw: bigint) { const digits = raw.toString().padStart(7, "0"); return `${digits.slice(0, -6)}.${digits.slice(-6)}`; }

export function BusinessOffers({ businessId, fingerprint, view, symbol }: { businessId: string; fingerprint: string; view: View; symbol: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = view.offers.filter((o) => o.status === "open" && o.signature);
  if (!open.length && !view.counter) return null;
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
    <p className="mt-2 text-xs text-graphite">Accepting an offer means paying the invoice. Review the Steward’s timing assessment before paying.</p>
    {open.map((offer) => <div key={offer.id} className="mt-3 text-sm">
      <p>{offer.discountPercent}% discount · saving {exact(BigInt(view.remaining) * BigInt(offer.discountBps) / 10_000n)} {symbol} · valid until {formatDateTime(new Date(offer.validUntil))}</p>
      {view.canAct ? <button disabled={busy} className="mt-2 underline" onClick={() => act("decline", offer.id)}>Decline offer</button> : null}
    </div>)}
    {view.counter ? <div className="mt-3 text-sm"><p>Steward recommends requesting {(view.counter.discountBps / 100).toFixed(2)}%. The vendor must sign fresh terms before payment.</p>
      {view.canAct ? <button disabled={busy} className="mt-2 underline" onClick={() => act("counter")}>Send this counter</button> : null}</div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red">{error}</p> : null}
  </section>;
}
