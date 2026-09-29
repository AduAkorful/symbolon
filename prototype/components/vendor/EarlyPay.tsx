"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { TxLink } from "@/components/TxLink";
import type { VInvoice } from "@/lib/ana";
import { E, registerMotion, strike } from "@/lib/motion";
import { tx } from "@/lib/tx";
import { Overlay } from "@/components/Overlay";

type Step = "choose" | "signing" | "waiting" | "countered" | "paid" | "declined";

const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Get paid today (V8): the vendor names a discount, sees exactly what they receive, signs, and gets an answer */
export function EarlyPay({ inv }: { inv: VInvoice }) {
  const total = Number(inv.amount);
  const [pct, setPct] = useState(1.2);
  const [step, setStep] = useState<Step>("choose");
  const [paidPct, setPaidPct] = useState(0);
  const receive = Math.round(total * (1 - pct / 100) * 100) / 100;
  const counterPct = 0.75;
  const paidRef = useRef<HTMLDivElement>(null);

  // The payer's Steward answers within minutes; here, a moment
  useLayoutEffect(() => {
    if (step !== "waiting") return;
    const t = setTimeout(() => setStep(pct <= counterPct ? "paid" : "countered"), 1600);
    if (pct <= counterPct) setPaidPct(pct);
    return () => clearTimeout(t);
  }, [step, pct]);

  useLayoutEffect(() => {
    if (step !== "paid" || !paidRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      strike(tl, "[data-a=paid]", 0);
      tl.from("[data-a=receipt]", { clipPath: "inset(0 0 100% 0)", duration: 0.4, ease: E("settle") }, 0.3);
    }, paidRef);
    return () => ctx.revert();
  }, [step]);

  const days = 30;
  return (
    <main className="px-6 pb-24 pt-8 md:px-10">
      <p className="text-sm text-graphite">
        <Link href={`/v/invoices/${inv.id}`} className="hover:text-ink">
          Invoice {inv.number}
        </Link>
        <span className="mx-1.5">/</span> Get paid today
      </p>
      <h1 className="mt-3 font-display text-5xl leading-none">Get paid today</h1>
      <p className="mt-3 max-w-[60ch] text-graphite">
        {inv.client} owes ${fmt(total)} on {inv.due}, {days} days from now. Offer a discount and their Steward decides within minutes.
        If they say no, nothing changes: you’re still paid in full on the due date.
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="offer">
          <h2 id="offer" className="sr-only">
            Your offer
          </h2>
          <label htmlFor="discount" className="text-sm text-graphite">
            Discount you offer
          </label>
          <div className="relative mt-4">
            {/* What the vendor has accepted before, as a soft band, not a snap point */}
            <div className="pointer-events-none absolute top-1/2 h-4 -translate-y-1/2 rounded-sm bg-seal-wash" style={{ left: `${(0.75 / 3) * 100}%`, width: `${((1.5 - 0.75) / 3) * 100}%` }} />
            <input
              id="discount"
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={pct}
              disabled={step !== "choose"}
              onChange={(e) => setPct(Number(e.target.value))}
              className="relative w-full accent-[var(--ink)]"
            />
          </div>
          <p className="mt-1 text-xs text-graphite">Shaded: what you’ve offered and had accepted before (0.75–1.5%)</p>

          <div className={`transition-opacity duration-[var(--dur-base)] ${step === "choose" || step === "signing" ? "" : "opacity-45"}`}>
          <p className="mt-8 text-sm text-graphite">{step === "choose" || step === "signing" ? "You receive today" : "Your offer"}</p>
          <p className="font-display text-7xl leading-none tabular-nums">${fmt(receive)}</p>
          <p className="mt-2 text-graphite">
            {pct.toFixed(2)}% off {fmt(total)} · you give up ${fmt(total - receive)}
          </p>
          </div>

          {step === "choose" ? (
            <button onClick={() => setStep("signing")} className="mt-8 rounded-doc bg-ink px-5 py-3 font-medium text-paper">
              Sign this offer
            </button>
          ) : null}
        </section>

        <section aria-live="polite" className="space-y-6">
          {step === "waiting" ? (
            <div className="rounded-doc border border-rule p-6">
              <p className="font-medium">Sent to {inv.client}’s Steward</p>
              <p className="mt-1 text-sm text-graphite">It weighs your offer against what their cash earns and what they have due.</p>
              <div className="mt-4 h-1 w-full overflow-hidden bg-rule-soft">
                <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] bg-seal" />
              </div>
            </div>
          ) : null}

          {step === "countered" ? (
            <div className="rounded-doc border border-seal/40 bg-paper-raised p-6">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Counter-offer</p>
              <p className="mt-2 text-xl font-medium leading-snug">
                {inv.client} can pay ${fmt(Math.round(total * (1 - counterPct / 100) * 100) / 100)} today at {counterPct}%.
              </p>
              <p className="mt-2 text-sm text-graphite">
                Their Steward counters once, within their owner’s limits. Accept to be paid now, or decline and be paid ${fmt(total)} on {inv.due}.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => {
                    setPaidPct(counterPct);
                    setStep("paid");
                  }}
                  className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper"
                >
                  Sign and accept {counterPct}%
                </button>
                <button onClick={() => setStep("declined")} className="rounded-doc border border-rule px-4 py-2.5 text-sm">
                  Decline
                </button>
              </div>
            </div>
          ) : null}

          {step === "declined" ? (
            <p className="rounded-doc border border-rule p-6">No change: you’re paid ${fmt(total)} on {inv.due}.</p>
          ) : null}

          {step === "paid" ? (
            <div ref={paidRef}>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Paid today</p>
              <p data-a="paid" className="mt-2 font-display text-6xl leading-none">
                ${fmt(Math.round(total * (1 - paidPct / 100) * 100) / 100)}
              </p>
              <dl data-a="receipt" className="mt-6 space-y-1.5 border-t border-rule pt-4 text-sm">
                {[
                  ["Invoice", `${inv.number}, ${inv.client}`],
                  ["Original", `$${fmt(total)}`],
                  ["Discount you signed", `${paidPct.toFixed(2)}%`],
                  ["Received", "Today, 14:21, on Arc"],
                  ["Transaction", "tx"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-graphite">{k}</dt>
                    <dd>{k === "Transaction" ? <TxLink hash={tx.payAnaEarly}>{tx.payAnaEarly}</TxLink> : v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      </div>

      {step === "signing" ? (
        <Overlay aria-labelledby="sign-offer">
          <div className="w-full max-w-lg rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl">
            <h2 id="sign-offer" className="font-display text-3xl">
              You’re offering
            </h2>
            <p className="mt-3">
              {pct.toFixed(2)}% off invoice {inv.number} if {inv.client} pays today: you receive <strong>${fmt(receive)}</strong> instead of ${fmt(total)} on {inv.due}.
            </p>
            <p className="mt-3 text-sm text-graphite">Your Seal signs the offer. They can’t pay less than this, and it expires tonight if unused.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setStep("waiting")} className="flex-1 rounded-doc bg-ink py-3 font-medium text-paper" autoFocus>
                Sign and send
              </button>
              <button onClick={() => setStep("choose")} className="rounded-doc border border-rule px-5 py-3">
                Back
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </main>
  );
}

