"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { D, E, S, registerMotion } from "@/lib/motion";

const extracted = [
  ["Client", "Kite & Co", "Page 1, “Bill to”"],
  ["Invoice number", "KITE-0917", "Page 1, top right (kept as your reference)"],
  ["Line 1", "Illustration set, 12 spot illustrations · 12 × 150.00", "Page 1, table"],
  ["Line 2", "Usage licence, 2 years · 1 × 600.00", "Page 1, table"],
  ["Total", "2,400.00", "Page 1, matches the lines"],
  ["Due", "30 days", "Page 1, “Terms: net 30”"],
];

const fromSettings = [
  ["Seal", "@studio-ana"],
  ["Paid in", "USDC on Arc"],
  ["Pay to", "0x7a3f…c219 (your Seal’s address)"],
];

type Step = "drop" | "reading" | "draft";

/** Upload a PDF (V5): the Steward extracts a draft; the vendor confirms. Payout details never come from the PDF. */
export function Upload() {
  const [step, setStep] = useState<Step>("drop");
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (step !== "reading" || !list.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep("draft");
      return;
    }
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ onComplete: () => setStep("draft") });
      tl.from("[data-a=field]", { opacity: 0, x: -8, duration: D.base, ease: E("settle"), stagger: S.field * 3 });
      tl.to({}, { duration: 0.4 });
    }, list);
    return () => ctx.revert();
  }, [step]);

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 className="font-display text-5xl">Upload a PDF</h1>
      <p className="mt-2 max-w-[62ch] text-graphite">
        Already made an invoice elsewhere? The Steward reads it into a draft. You check every field, then seal it.
      </p>

      {step === "drop" ? (
        <div className="mt-10 grid max-w-3xl place-items-center rounded-doc border-2 border-dashed border-rule px-6 py-20 text-center">
          <p className="text-lg">Drop a PDF here</p>
          <p className="mt-1 text-sm text-graphite">or</p>
          <button onClick={() => setStep("reading")} className="mt-3 rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
            Use the sample invoice (kite-invoice.pdf)
          </button>
        </div>
      ) : (
        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section ref={list} aria-label="What the Steward read">
            <p className="text-sm text-graphite">
              {step === "reading" ? "Reading kite-invoice.pdf…" : "From kite-invoice.pdf. Check each field; change anything that’s wrong."}
            </p>
            <dl className="mt-4 border-t border-ink">
              {extracted.map(([k, v, where]) => (
                <div key={k} data-a="field" className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-sm text-graphite">{k}</dt>
                  <dd>
                    {v}
                    <span className="block text-xs text-graphite">{where}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <aside className="space-y-6">
            <div className="rounded-doc border border-rule bg-paper-raised p-5">
              <p className="font-medium">From your settings, never from the PDF</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                {fromSettings.map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <dt className="w-16 shrink-0 text-graphite">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-graphite">
                A PDF can say anything. Who you are and where you’re paid come only from your own account.
              </p>
            </div>
            {step === "draft" ? (
              <Link href="/v/new?from=upload" className="inline-block rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                Review and seal
              </Link>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}
