"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { DemoTag, SealStamp, Wordmark } from "@/components/Marks";
import { D, E, registerMotion, strike } from "@/lib/motion";

const FP = "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308";

function Letters({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap">
          {w.split("").map((ch, ci) => (
            <span key={ci} data-a="ch" className="inline-block" style={{ backfaceVisibility: "hidden" }}>
              {ch}
            </span>
          ))}
          <span className="inline-block">&nbsp;</span>
        </span>
      ))}
    </>
  );
}

const cannot = [
  "Pay an invoice that isn’t sealed, unless a person signs a manual payment",
  "Pay the same invoice twice, or beyond its total",
  "Pay an address the vendor’s Seal didn’t sign and you didn’t confirm",
  "Add or change a vendor, an address or a Seal",
  "Exceed a budget, a cap, an order’s remaining amount or an approval threshold",
  "Withdraw funds, change the policy, or change its own permissions",
];

/** The landing page: the one place the headline turns in on 3D (borrowed from direction B) */
export function Landing() {
  const hero = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!hero.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ delay: 0.15 });
      tl.from("[data-a=ch]", { rotationX: -95, opacity: 0, transformOrigin: "50% 50% -24px", duration: D.deliberate, ease: E("arrive"), stagger: 0.018 }, 0);
      tl.from("[data-a=sub]", { opacity: 0, y: 10, duration: D.move, ease: E("arrive"), stagger: 0.08 }, 0.7);
      tl.from("[data-a=left]", { x: -70, opacity: 0, duration: D.deliberate, ease: E("close") }, 0.9);
      tl.from("[data-a=right]", { x: 70, opacity: 0, duration: D.deliberate, ease: E("close") }, 0.9);
      strike(tl, "[data-a=stamp]", 0.9 + D.deliberate + 0.12);
    }, hero);
    return () => ctx.revert();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-6 pt-7 md:px-10">
        <Wordmark />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/p/verify" className="hidden text-graphite hover:text-ink sm:inline">
            Verify an invoice
          </Link>
          <Link href="/signin" className="text-graphite hover:text-ink">
            Sign in
          </Link>
          <Link href="/v/start" className="rounded-doc bg-ink px-4 py-2 font-medium text-paper">
            Start free
          </Link>
        </nav>
      </header>

      <main>
        <section ref={hero} className="mx-auto grid max-w-[1180px] gap-14 px-6 pb-20 pt-16 md:px-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
          <div>
            <p data-a="sub" className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">
              Payables on Arc · settled in USDC and EURC
            </p>
            <h1 className="mt-5 font-display text-[clamp(2.5rem,4.6vw,4.3rem)] leading-[1.02] tracking-[-0.01em]" style={{ perspective: "700px" }} aria-label="Invoices that prove who sent them. Payments that pay you back.">
              <span aria-hidden>
                <Letters text="Invoices that prove who sent them." />
                <span className="block text-graphite">
                  <Letters text="Payments that pay you back." />
                </span>
              </span>
            </h1>
            <p data-a="sub" className="mt-6 max-w-[54ch] text-lg text-graphite">
              Vendors seal every invoice. Businesses pay through a Vault run by an AI Steward, inside limits the Vault itself enforces. A
              payment releases only when the halves match.
            </p>
            <div data-a="sub" className="mt-8 flex flex-wrap gap-3">
              <Link href="/v/start" className="rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                Send your first invoice
              </Link>
              <Link href="/setup" className="rounded-doc border border-ink px-5 py-3 font-medium">
                Set up your business
              </Link>
            </div>
          </div>

          <div className="relative flex" aria-hidden>
            <div data-a="left" className="w-1/2 drop-shadow-[0_18px_30px_rgba(21,33,28,0.12)]">
              <Half side="vendor" fingerprint={FP} className="h-[330px] bg-paper-raised" tone="var(--seal)">
                <div className="px-6 py-7 pr-11">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">The vendor’s half</p>
                  <p className="mt-2 font-display text-2xl">Studio Ana</p>
                  <SealStamp handle="@studio-ana" size={52} className="mt-4 rotate-[-6deg]" />
                  <p className="mt-5 text-sm text-graphite">Invoice 0143 · $2,000.00</p>
                </div>
              </Half>
            </div>
            <div data-a="right" className="-ml-[22px] w-[calc(50%+22px)] drop-shadow-[0_18px_30px_rgba(21,33,28,0.12)]">
              <Half side="payer" fingerprint={FP} className="h-[330px] bg-paper-raised" tone="var(--seal)">
                <div className="px-6 py-7 pl-11">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">The payer’s half</p>
                  <p className="mt-2 font-display text-2xl">Acme</p>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    <li>✓ Order PO-0031</li>
                    <li>✓ Delivered 30 Sep</li>
                    <li>✓ Within policy</li>
                  </ul>
                </div>
              </Half>
            </div>
            <div data-a="stamp" className="absolute left-1/2 top-[74%] -translate-x-1/2 rotate-[-9deg] rounded-sm border-2 border-seal bg-paper-raised/90 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-seal">
              Matched
            </div>
          </div>
        </section>

        <section className="border-y border-rule bg-paper-raised/50">
          <div className="mx-auto grid max-w-[1180px] gap-10 px-6 py-16 md:grid-cols-3 md:px-10">
            {[
              ["For freelancers", "Send invoices for free, get paid in seconds, and get paid today if you want.", "/v/start", "Start as a vendor"],
              ["For founders and ops", "An agent that runs your payables, earns more than idle cash does, and can’t pay a changed address.", "/setup", "Set up your business"],
              ["For accountants", "Every payment points at a signed document, a matched order and a recorded reason.", "/p/verify", "Verify an invoice"],
            ].map(([t, d, href, cta]) => (
              <div key={t}>
                <h2 className="font-display text-3xl">{t}</h2>
                <p className="mt-3 text-graphite">{d}</p>
                <Link href={href} className="mt-4 inline-block underline decoration-rule underline-offset-4">
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-[1180px] gap-12 px-6 py-20 md:px-10 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-5xl leading-none">The name is the idea.</h2>
            <p className="mt-5 max-w-[52ch] text-lg text-graphite">
              A <em>symbolon</em> was an object broken in two; each party kept a half, and an agreement was proven when the halves fitted.
              Here the vendor’s sealed invoice is one half, and the payer’s order and delivery are the other. Both are cut from the
              invoice’s fingerprint, so only the true pair fits.
            </p>
          </div>
          <div>
            <h2 className="font-display text-3xl">What the Steward can’t do, however it’s asked</h2>
            <ul className="mt-5 border-t border-ink">
              {cannot.map((c) => (
                <li key={c} className="flex gap-3 border-b border-rule py-3">
                  <span className="text-red" aria-hidden>
                    ×
                  </span>
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-graphite">These limits live in each business’s Vault contract, not in the Steward’s instructions.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-graphite md:px-10">
          <DemoTag />
          <span>A prototype. Names, invoices and amounts are demo data.</span>
          <span className="ml-auto flex gap-4">
            <Link href="/frames" className="hover:text-ink">
              Design review
            </Link>
            <Link href="/storyboards" className="hover:text-ink">
              Storyboards
            </Link>
            <Link href="/motion" className="hover:text-ink">
              Motion
            </Link>
            <Link href="/animatic" className="hover:text-ink">
              Animatic
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
