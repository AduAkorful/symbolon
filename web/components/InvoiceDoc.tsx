import type { InvoiceDocument } from "@symbolon/seal";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { checksum, discounted, showAmount, showBps, showDate } from "@/lib/format";

/**
 * An invoice, drawn from the canonical document and nothing else (plan 05i, V2): what a person confirms before signing, and
 * what anyone sees on the public link, is these same fields. `fingerprint` is written along the cut once it exists.
 */
export function InvoiceDoc({ document: d, fingerprint, handle, sealed = false }: { document: InvoiceDocument; fingerprint: string; handle: string; sealed?: boolean }) {
  const sym = d.currency.symbol;
  return (
    <div className="drop-shadow-[0_14px_24px_rgba(0,0,0,0.45)]">
      <Half side="vendor" fingerprint={fingerprint} className="bg-paper-raised" tone={sealed ? "var(--seal)" : "var(--rule)"}>
        <article className="px-7 py-8 pr-14 text-ink">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="break-words font-display text-3xl leading-none">{d.vendor.name}</p>
              <p className="mt-1 font-mono text-xs text-graphite">@{handle}</p>
              {d.vendor.website ? <p className="mt-1 break-all text-xs text-graphite">{d.vendor.website}</p> : null}
            </div>
            {sealed ? (
              <span data-a="stamp" className="shrink-0">
                <SealStamp handle={`@${handle}`} size={64} className="-mt-1 rotate-[-8deg]" />
              </span>
            ) : (
              <span className="shrink-0 rounded-full border border-dashed border-rule px-3 py-1 text-xs text-graphite">Not signed yet</span>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-rule py-3 text-sm">
            <dt className="text-graphite">Invoice</dt>
            <dd className="break-words text-right">No. {d.invoiceNumber}</dd>
            <dt className="text-graphite">To</dt>
            <dd className="break-words text-right">{d.payer.name}</dd>
            <dt className="text-graphite">Issued</dt>
            <dd className="text-right">{showDate(d.issuedAt)}</dd>
            <dt className="text-graphite">Due</dt>
            <dd className="text-right">{showDate(d.dueDate)}</dd>
            {d.poNumber ? (
              <>
                <dt className="text-graphite">PO</dt>
                <dd className="break-words text-right">{d.poNumber}</dd>
              </>
            ) : null}
          </dl>

          <ul className="mt-4 text-sm">
            {d.lineItems.map((l, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-rule-soft py-2">
                <span className="min-w-0 whitespace-pre-line break-words">
                  {l.description}
                  <span className="block text-xs text-graphite">
                    {l.quantity} × {showAmount(l.unitPrice)}
                  </span>
                </span>
                <span className="shrink-0">{showAmount(l.amount)}</span>
              </li>
            ))}
            {d.taxes.map((t, i) => (
              <li key={`t${i}`} className="flex justify-between border-b border-rule-soft py-2 text-graphite">
                <span>
                  {t.label}
                  {t.rateBps !== undefined ? ` ${showBps(t.rateBps)}%` : ""}
                </span>
                <span className="">{showAmount(t.amount)}</span>
              </li>
            ))}
            {d.discounts.map((t, i) => (
              <li key={`d${i}`} className="flex justify-between border-b border-rule-soft py-2 text-graphite">
                <span>{t.label}</span>
                <span className="">−{showAmount(t.amount)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3">
            <span className="text-sm">Total</span>
            <span className="font-display text-3xl">
              {showAmount(d.total)} <span className="text-sm text-graphite">{sym}</span>
            </span>
          </p>

          {d.earlyPay.length ? (
            <div className="mt-3 text-xs text-graphite">
              <p>Early Pay, at the payer’s choice:</p>
              <ul className="mt-1 space-y-0.5">
                {d.earlyPay.map((t, i) => (
                  <li key={i}>
                    {showBps(t.discountBps)}% off if paid by {showDate(t.payBy)} → {showAmount(discounted(d.total, d.currency.decimals, t.discountBps))} {sym}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 break-all text-xs text-graphite">
            Paid in {sym} on Arc to <span data-wrap-ok className="font-mono">{checksum(d.payout.address)}</span>
          </p>
          {d.terms ? <p className="mt-3 whitespace-pre-line text-xs text-graphite">{d.terms}</p> : null}
          {d.notes ? <p className="mt-3 whitespace-pre-line text-xs text-graphite">{d.notes}</p> : null}
        </article>
      </Half>
      <p className="mt-3 break-all font-mono text-xs text-graphite">
        Fingerprint {fingerprint.slice(0, 10)}…{fingerprint.slice(-6)}
      </p>
    </div>
  );
}
