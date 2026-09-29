"use client";

import Link from "next/link";
import { useState } from "react";
import { Half } from "@/components/Chirograph";
import { DemoTag, SealStamp, Wordmark } from "@/components/Marks";
import { Money } from "@/components/Money";
import { invoice, payer, vendor } from "@/lib/demo";
import { Overlay } from "@/components/Overlay";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const DOMAIN_VERIFIED = true;

type Pay = "idle" | "connect" | "confirm" | "paid";

/** The public invoice link (P1): the sealed half, the empty other half, and paying once without an account */
export function InvoiceLink() {
  const [pay, setPay] = useState<Pay>("idle");
  const { vendorLogo } = useProfile();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10">
        <Wordmark />
        <div className="flex items-center gap-3 sm:gap-5">
          <DemoTag />
          <Link href="/p/verify" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
            Verify an invoice
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-14 md:px-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Invoice for {payer.name}</p>
        <h1 className="mt-3 max-w-[16ch] font-display text-[clamp(2.4rem,5vw,4.1rem)] leading-[1.02] tracking-[-0.01em]">
          {vendor.name} sent you an invoice for <span className="whitespace-nowrap">2,400 USDC.</span>
        </h1>
        <p className="mt-4 text-graphite">Due {invoice.due}. Pay in seconds, or earlier for less.</p>

        <div className="mt-12 flex flex-col lg:flex-row lg:items-stretch">
          {/* The vendor's half: the sealed invoice */}
          <div className="drop-shadow-[0_18px_30px_rgba(21,33,28,0.10)] lg:w-[64%]">
            <Half side="vendor" fingerprint={invoice.fingerprint} className="bg-paper-raised">
              <article className="px-6 py-8 pr-12 md:px-10 md:py-10 md:pr-20">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex items-center gap-4">
                    {/* The logo is drawn because studio-ana.com is verified; without that, anyone opening the link sees initials (spec 11.6) */}
                    <Avatar name={vendor.name} src={vendorLogo} show={DOMAIN_VERIFIED} size={52} />
                    <div>
                      <p className="font-display text-3xl leading-none">{vendor.name}</p>
                      <p className="mt-1.5 font-mono text-xs text-graphite">{vendor.handle}</p>
                      {DOMAIN_VERIFIED ? <p className="mt-1 text-xs text-seal">✓ studio-ana.com verified</p> : null}
                    </div>
                  </div>
                  <SealStamp handle={vendor.handle} size={78} className="-mt-2 rotate-[-8deg]" />
                </div>

                <dl className="mt-8 grid grid-cols-2 gap-y-3 border-y border-rule py-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-graphite">Invoice</dt>
                    <dd className="mt-0.5 font-medium">No. {invoice.number}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite">Issued</dt>
                    <dd className="mt-0.5 font-medium">{invoice.issued}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite">Due</dt>
                    <dd className="mt-0.5 font-medium">{invoice.due}</dd>
                  </div>
                  <div>
                    <dt className="text-graphite">Billed to</dt>
                    <dd className="mt-0.5 font-medium">{payer.name}</dd>
                  </div>
                </dl>

                <table className="mt-6 w-full text-sm">
                  <thead>
                    <tr className="text-left text-graphite">
                      <th className="pb-2 font-normal">Item</th>
                      <th className="pb-2 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => (
                      <tr key={l.description} className="border-t border-rule-soft">
                        <td className="py-3 pr-4">{l.description}</td>
                        <td className="py-3 text-right">
                          <Money raw={l.amount} tabular />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-ink">
                      <td className="pt-4 font-medium">Total</td>
                      <td className="pt-4 text-right font-display text-2xl sm:text-3xl">
                        <Money raw={invoice.total} token="USDC" />
                      </td>
                    </tr>
                  </tfoot>
                </table>

                <section className="mt-9">
                  <h2 className="text-sm font-medium">Pay early, pay less</h2>
                  <p className="mt-1 text-sm text-graphite">Discounts {vendor.name} signed into this invoice.</p>
                  <ol className="mt-4 grid gap-px overflow-hidden rounded-doc border border-rule bg-rule sm:grid-cols-3">
                    {invoice.earlyPay.map((t, i) => (
                      <li key={t.label} className={`bg-paper-raised px-4 py-3 ${i === 0 ? "bg-seal-wash/60" : ""}`}>
                        <p className="text-xs text-graphite">
                          {t.label} · until {t.until}
                        </p>
                        <p className="mt-1 text-lg font-medium">
                          <Money raw={t.pay} />
                        </p>
                        <p className="text-xs text-graphite">{t.bps ? `${(t.bps / 100).toFixed(2)}% off` : "Full amount"}</p>
                      </li>
                    ))}
                  </ol>
                </section>

                <footer className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule pt-4 text-xs text-graphite">
                  <span>
                    Paid in {vendor.token} on {vendor.chain} to <span className="font-mono text-ink">{vendor.payout}</span>
                  </span>
                  <span>
                    Attached: <span className="text-ink underline decoration-rule underline-offset-2">{invoice.attachment}</span>
                  </span>
                </footer>
              </article>
            </Half>
          </div>

          {/* The payer's half, still empty: what this invoice needs to meet */}
          <div className="mt-6 lg:mt-0 lg:-ml-[22px] lg:w-[36%]">
            <Half side="payer" fingerprint={invoice.fingerprint} className="h-full bg-paper/70 backdrop-blur-[1px]" tone="var(--graphite)">
              <div className="flex h-full flex-col px-7 py-8 lg:pl-14 md:py-10">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">The other half</p>
                <p className="mt-3 font-display text-2xl leading-tight">
                  This invoice pays out when it meets your side: the order, the delivery, your approval.
                </p>
                <div className="mt-8 space-y-3">
                  <button onClick={() => setPay("connect")} className="flex w-full items-center justify-between rounded-doc bg-ink px-5 py-3.5 text-left text-paper transition hover:bg-ink/90">
                    <span className="font-medium">Pay with a wallet</span>
                    <span className="text-sm text-paper/75">
                      <Money raw={invoice.earlyPay[0]!.pay} precise={false} /> today
                    </span>
                  </button>
                  <Link href="/setup" className="block w-full rounded-doc border border-ink px-5 py-3.5 text-left font-medium transition hover:bg-ink/5">
                    Set up {payer.name.split(" ")[0]} on Symbolon
                  </Link>
                </div>
                <p className="mt-4 text-sm text-graphite">
                  With an account, your Steward matches invoices like this to your orders and pays within the rules you set.
                </p>
                <div className="mt-auto pt-10">
                  <div className="flex items-start gap-3 border-t border-rule pt-4 text-sm">
                    <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-seal" />
                    <p className="text-graphite">
                      <span className="text-ink">Sealed by {vendor.name}.</span> New to Symbolon, so you’ll confirm the studio once, through a channel
                      you already use, before your first payment.
                    </p>
                  </div>
                </div>
              </div>
            </Half>
          </div>
        </div>
      </main>
      {pay !== "idle" ? (
        <Overlay aria-labelledby="pay-title">
          <div className="w-full max-w-md rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl">
            {pay === "connect" ? (
              <>
                <h2 id="pay-title" className="font-display text-3xl">
                  Pay with a wallet
                </h2>
                <p className="mt-2 text-sm text-graphite">Connect the wallet you pay from. It needs USDC on Arc; fees are paid in USDC too.</p>
                <ul className="mt-5 space-y-2">
                  {["Browser wallet", "WalletConnect", "Coinbase Wallet"].map((w) => (
                    <li key={w}>
                      <button onClick={() => setPay("confirm")} className="w-full rounded-doc border border-rule px-4 py-3 text-left hover:border-ink">
                        {w}
                      </button>
                    </li>
                  ))}
                </ul>
                <button onClick={() => setPay("idle")} className="mt-5 text-sm underline decoration-rule underline-offset-4">
                  Cancel
                </button>
              </>
            ) : pay === "confirm" ? (
              <>
                <h2 id="pay-title" className="font-display text-3xl">
                  You’re paying
                </h2>
                <dl className="mt-5 space-y-2 text-sm">
                  {[
                    ["To", `${vendor.name}, at the address its Seal signed`],
                    ["Invoice", `No. ${invoice.number}`],
                    ["Amount", "2,364.00 USDC (1.50% off, paid within 3 days)"],
                    ["From", "Your wallet, 0x3b8a…41d2"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-4 border-b border-rule-soft pb-2">
                      <dt className="w-16 shrink-0 text-graphite">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-6 flex gap-3">
                  <button onClick={() => setPay("paid")} className="flex-1 rounded-doc bg-ink py-3 font-medium text-paper" autoFocus>
                    Confirm in wallet
                  </button>
                  <button onClick={() => setPay("idle")} className="rounded-doc border border-rule px-5 py-3">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Paid</p>
                <h2 id="pay-title" className="mt-2 font-display text-5xl leading-none">
                  $2,364.00
                </h2>
                <p className="mt-3 text-sm text-graphite">Settled in 0.6 s. {vendor.name} has been paid and gets a receipt; so do you.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/p/receipt" className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
                    See the receipt
                  </Link>
                  <Link href="/setup" className="rounded-doc border border-rule px-4 py-2.5 text-sm">
                    Set up Acme on Symbolon
                  </Link>
                </div>
              </>
            )}
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
