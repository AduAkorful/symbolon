import Link from "next/link";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { Money } from "@/components/Money";
import { TxLink } from "@/components/TxLink";
import type { VInvoice } from "@/lib/ana";
import { VStatusTag } from "./VStatusTag";
import { Act } from "@/components/Act";

/** One invoice from the vendor's side (V7): where it is, what was paid, and what the vendor can do next */
export function VInvoiceView({ inv }: { inv: VInvoice }) {
  const open = inv.status !== "paid" && inv.status !== "cancelled";
  return (
    <main className="px-6 pb-24 pt-8 md:px-10">
      <p data-reveal className="text-sm text-graphite">
        <Link href="/v/invoices" className="hover:text-ink">
          Invoices
        </Link>
        <span className="mx-1.5">/</span> {inv.number}
      </p>
      <div data-reveal className="mt-3 flex flex-wrap items-center gap-4">
        <VStatusTag status={inv.status} />
        <span className="text-sm text-graphite">{inv.note}</span>
      </div>
      <h1 data-reveal className="mt-2 font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-none">
        <Money raw={inv.paid?.amount ?? inv.amount} symbol="$" precise={false} />
      </h1>
      <p data-reveal className="mt-2 text-graphite">
        {inv.paid ? `Received from ${inv.client}` : `From ${inv.client}, due ${inv.due}`}
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section data-reveal aria-label="The invoice">
          <div className="max-w-md drop-shadow-[0_14px_24px_rgba(21,33,28,0.10)]">
            <Half side="vendor" fingerprint={inv.fingerprint} className="bg-paper-raised" tone="var(--seal)">
              <div className="px-7 py-8 pr-14">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-3xl leading-none">Studio Ana</p>
                    <p className="mt-1 font-mono text-xs text-graphite">Invoice {inv.number}</p>
                  </div>
                  <SealStamp handle="@studio-ana" size={60} className="rotate-[-8deg]" />
                </div>
                <dl className="mt-6 space-y-2 text-sm">
                  {[
                    ["To", inv.client],
                    ["Issued", inv.issued],
                    ["Due", inv.due],
                    ["Amount", `${Number(inv.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-rule-soft pb-2">
                      <dt className="text-graphite">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </Half>
          </div>
        </section>

        <section className="space-y-8">
          <div data-reveal>
            <h2 className="font-display text-3xl">Where it is</h2>
            <ol className="mt-4 border-l border-rule pl-5">
              {inv.timeline.map((t) => (
                <li key={t.what} className="relative pb-5">
                  <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 ${t.done ? "border-seal bg-seal" : "border-rule bg-paper"}`} />
                  <p className={t.done ? "" : "text-graphite"}>{t.what}</p>
                  <p className="font-mono text-xs text-graphite">{t.at}</p>
                </li>
              ))}
            </ol>
          </div>

          {inv.paid ? (
            <div data-reveal className="rounded-doc border border-rule bg-paper-raised p-5">
              <h2 className="font-medium">Receipt</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-graphite">Invoice total</dt>
                  <dd>
                    <Money raw={inv.amount} symbol="$" precise={false} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-graphite">Early Pay you signed</dt>
                  <dd>{inv.paid.discountBps ? `${(inv.paid.discountBps / 100).toFixed(2)}%` : "None"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-graphite">Received</dt>
                  <dd className="font-medium">
                    <Money raw={inv.paid.amount} symbol="$" precise={false} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-graphite">When</dt>
                  <dd>{inv.paid.at}, on Arc</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-3">
                <Link href="/p/receipt" className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink">
                  Share the receipt
                </Link>
                <TxLink hash={inv.paid.tx} className="self-center">
                  {inv.paid.tx}
                </TxLink>
              </div>
            </div>
          ) : null}

          {open ? (
            <div data-reveal className="space-y-3">
              {inv.clientOn ? (
                <Link href={`/v/invoices/${inv.id}/early`} className="inline-block rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                  Get paid today
                </Link>
              ) : (
                <p className="text-sm text-graphite">
                  {inv.client} isn’t on Symbolon yet, so Get paid today isn’t available. When they pay through the link, they can join.
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <Act
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                  confirm={{ title: "Issue a credit note", body: `You sign a credit note against ${inv.number}. ${inv.client}’s owner confirms it before it takes effect.`, action: "Sign and send" }}
                  done={`Signed and sent to ${inv.client}. It applies when their owner confirms.`}
                >
                  Issue a credit note
                </Act>
                <Link href="/v/new?from=correction" className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
                  Send a corrected invoice
                </Link>
                <Act
                  className="rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash"
                  confirm={{ title: `Cancel ${inv.number}`, body: "You sign a cancellation. Once the client confirms it, this invoice can never be paid.", action: "Sign and cancel" }}
                  done={`Cancellation signed and sent to ${inv.client}. It’s final once they confirm.`}
                >
                  Cancel invoice
                </Act>
              </div>
              <p className="text-xs text-graphite">A sealed invoice can’t be edited. Corrections are sealed too, and cancel the original for good.</p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
