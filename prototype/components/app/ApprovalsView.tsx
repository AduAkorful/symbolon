"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { TxLink } from "@/components/TxLink";
import { invoiceById } from "@/lib/acme";
import { D, E, registerMotion, roll, strike, writeIn } from "@/lib/motion";
import { tx } from "@/lib/tx";
import { usePause } from "./pause";
import { Overlay } from "@/components/Overlay";

type Step = "review" | "signing" | "paying" | "paid" | "rejecting" | "rejected";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Approvals (B13): the Steward's recommendation, the rule that needs a human, and a signature */
export function ApprovalsView() {
  const inv = invoiceById("northwind-2291")!;
  const { paused } = usePause();
  const [step, setStep] = useState<Step>("review");
  const [reason, setReason] = useState("");
  const sheet = useRef<HTMLDivElement>(null);
  const money = useRef<HTMLDivElement>(null);

  // The signing sheet rises (storyboard: seal, beat 2)
  useLayoutEffect(() => {
    if (step !== "signing" || !sheet.current || reduced()) return;
    registerMotion();
    const t = gsap.from(sheet.current, { y: 120, opacity: 0, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [step]);

  // After signing: $5,000.00 moves from reserve to operating, then $8,892.00 goes out (Get paid today, beat 4)
  useLayoutEffect(() => {
    if (step !== "paying" || !money.current) return;
    if (reduced()) {
      setStep("paid");
      return;
    }
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ onComplete: () => setStep("paid") });
      tl.fromTo("[data-a=flow]", { opacity: 1, x: 0 }, { x: 200, opacity: 0, duration: 0.6, ease: E("settle") }, 0);
      tl.from("[data-a=bar-reserve]", { height: "100%", duration: 0.6, ease: E("settle") }, 0);
      roll(tl, document.querySelector("[data-a=v-reserve]"), 22000, 0, 0.6);
      tl.from("[data-a=bar-operating]", { height: "92%", duration: D.base, ease: E("settle") }, 0.75);
      roll(tl, document.querySelector("[data-a=v-operating]"), 43320, 0.75, D.base);
      tl.to({}, { duration: 0.5 });
    }, money);
    return () => ctx.revert();
  }, [step]);

  const paidRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (step !== "paid" || !paidRef.current || reduced()) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      strike(tl, "[data-a=paid]", 0);
      writeIn(tl, "[data-a=line]", 0.25);
    }, paidRef);
    return () => ctx.revert();
  }, [step]);

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Approvals
      </h1>
      <p data-reveal className="mt-2 text-graphite">
        Payments a rule says a person must sign. The Steward recommends; you decide.
      </p>

      <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <article data-reveal className="rounded-doc border border-seal/40 bg-paper-raised p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-mono uppercase tracking-[0.14em] text-seal">Early Pay request</span>
            <Link href={`/b/inbox/${inv.id}`} className="text-graphite underline decoration-rule underline-offset-4">
              Invoice {inv.number}
            </Link>
          </div>
          <h2 className="mt-3 text-2xl font-medium leading-snug">Northwind Agency wants $8,892.00 today instead of $9,000.00 in 25 days</h2>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-rule py-5 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-graphite">Pay today</dt>
              <dd className="mt-1 text-lg font-medium">$8,892.00</dd>
            </div>
            <div>
              <dt className="text-graphite">Discount</dt>
              <dd className="mt-1 text-lg font-medium">1.20% · $108.00</dd>
            </div>
            <div>
              <dt className="text-graphite">A year, roughly</dt>
              <dd className="mt-1 text-lg font-medium">17.5%</dd>
            </div>
            <div>
              <dt className="text-graphite">Reserve earns</dt>
              <dd className="mt-1 text-lg font-medium">3.2%</dd>
            </div>
          </dl>

          <div className="mt-5 border-l-2 border-seal pl-4">
            <p className="text-xs uppercase tracking-[0.12em] text-graphite">Steward recommends</p>
            <p className="mt-1 text-lg leading-snug">{inv.steward.says}</p>
          </div>
          <ul className="mt-5 space-y-1.5 text-sm">
            {inv.acme.map((h) => (
              <li key={h.label} className="flex gap-2">
                <span className={h.ok ? "text-seal" : "text-graphite"}>{h.ok ? "✓" : "•"}</span>
                <span className="text-graphite">{h.label}:</span> {h.value}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-graphite">Why you: {inv.steward.rule}.</p>

          {step === "review" ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                disabled={paused}
                onClick={() => setStep("signing")}
                className="rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40"
              >
                Approve and sign
              </button>
              <button onClick={() => setStep("rejecting")} className="rounded-doc border border-rule px-5 py-3 font-medium hover:border-ink">
                Reject
              </button>
              {paused ? <p className="w-full text-sm text-red">Payments are paused. Resume to approve.</p> : null}
            </div>
          ) : null}

          {step === "rejecting" ? (
            <form
              className="mt-6 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) setStep("rejected");
              }}
            >
              <label className="block text-sm" htmlFor="reason">
                Why? Northwind sees this, and the Steward learns from it.
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-doc border border-rule bg-paper p-3 text-sm focus:border-ink"
                placeholder="For example: we pay agencies on the due date this quarter"
              />
              <div className="flex gap-3">
                <button type="submit" disabled={!reason.trim()} className="rounded-doc bg-ink px-5 py-2.5 text-sm font-medium text-paper disabled:opacity-40">
                  Reject the offer
                </button>
                <button type="button" onClick={() => setStep("review")} className="rounded-doc border border-rule px-5 py-2.5 text-sm">
                  Back
                </button>
              </div>
            </form>
          ) : null}

          {step === "rejected" ? (
            <p role="status" className="mt-6 border-t border-rule pt-4 text-sm">
              Offer rejected. The invoice stays scheduled for 23 Oct at the full $9,000.00, and Northwind has your reason.
            </p>
          ) : null}
        </article>

        <aside className="space-y-8">
          <section data-reveal ref={money} aria-label="Where the money comes from">
            <h2 className="font-display text-3xl">Where the money comes from</h2>
            <div className="relative mt-6 flex h-64 items-end justify-around border-b border-ink">
              {[
                { key: "reserve", name: "Reserve", v: step === "review" || step === "signing" || step === "rejecting" || step === "rejected" ? "$22,000.00" : "$17,000.00", h: step === "paying" || step === "paid" ? "56%" : "73%", tone: "border-seal bg-seal-wash" },
                { key: "operating", name: "Operating", v: step === "paying" || step === "paid" ? "$34,428.00" : "$38,320.00", h: step === "paying" || step === "paid" ? "80%" : "88%", tone: "border-ink bg-paper-raised" },
              ].map((b) => (
                <div key={b.key} className="flex h-full w-32 flex-col items-center justify-end">
                  <p data-a={`v-${b.key}`} className="mb-2 text-lg font-medium">
                    {b.v}
                  </p>
                  <div data-a={`bar-${b.key}`} className={`w-full border-2 ${b.tone}`} style={{ height: b.h }} />
                </div>
              ))}
              <div data-a="flow" className="absolute bottom-1/3 left-[28%] h-10 w-24 rounded-sm bg-seal/70 opacity-0" />
            </div>
            <div className="mt-2 flex justify-around text-sm text-graphite">
              <span>Reserve</span>
              <span>Operating</span>
            </div>
            <p className="mt-4 text-sm text-graphite">
              Signing redeems $5,000.00 from reserve first, so operating stays above the $20,000.00 buffer after paying $8,892.00.
            </p>
          </section>

          {step === "paid" ? (
            <section ref={paidRef} role="status" aria-label="Paid">
              <p data-a="paid" className="font-display text-6xl leading-none">
                Paid $8,892.00
              </p>
              <p className="mt-2 text-graphite">To Northwind Agency, settled in 0.6 s. Their receipt shows $9,000.00, 1.20% off, paid today.</p>
              <p data-a="line" className="mt-6 flex items-baseline gap-4 border-y border-rule py-3 text-sm">
                <span className="font-mono text-xs text-graphite">14:08</span> You approved; the Steward redeemed $5,000.00 and paid Northwind
              </p>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-graphite">
                <TxLink hash={tx.redeem}>Reserve redeem {tx.redeem}</TxLink>
                <TxLink hash={tx.payNorthwind}>Payment {tx.payNorthwind}</TxLink>
              </p>
            </section>
          ) : null}
        </aside>
      </div>

      {step === "signing" ? (
        <Overlay aria-labelledby="sign-title">
          <div ref={sheet} className="w-full max-w-lg rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl">
            <h2 id="sign-title" className="font-display text-3xl">
              You’re signing
            </h2>
            <dl className="mt-5 space-y-2 text-sm">
              {[
                ["Pay", "Northwind Agency"],
                ["Amount", "$8,892.00 ($9,000.00 less the 1.20% they signed)"],
                ["For", "Invoice 2291"],
                ["First", "Redeem $5,000.00 from reserve"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 border-b border-rule-soft pb-2">
                  <dt className="w-20 shrink-0 text-graphite">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-graphite">Your signature counts as the approver’s. Acme’s Vault checks it again before any money moves.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setStep("paying")} className="flex-1 rounded-doc bg-ink py-3 font-medium text-paper" autoFocus>
                Sign and pay
              </button>
              <button onClick={() => setStep("review")} className="rounded-doc border border-rule px-5 py-3">
                Cancel
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
      <p className="mt-10 text-sm text-graphite">
        Nothing else is waiting for you.
      </p>
    </main>
  );
}
