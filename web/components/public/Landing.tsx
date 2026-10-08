"use client";

import { NetworkNumbers } from "@/components/public/NetworkNumbers";
import { CONTAINER } from "@/components/shell/container";
import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { D, E, registerMotion, strike } from "@/lib/motion";
import { buttonClass } from "@/components/ui/button";

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

const CANNOT_ITEMS = [
  "Pay an invoice that isn’t sealed, unless an authorized human signs a manual payment",
  "Pay the same invoice twice, or beyond its total",
  "Pay an address the vendor’s Seal didn’t sign and an owner didn’t confirm",
  "Add or change a vendor, an address or a Seal",
  "Exceed a budget, a cap, an order’s remaining amount or an approval threshold",
  "Withdraw funds, change policy, or change its own permissions",
];

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
    <div className="min-h-screen flex flex-col justify-between">
      <PublicHeader />

      <main id="main-content">
        <section ref={hero} className={`${CONTAINER} overflow-x-clip grid grid-cols-[minmax(0,1fr)] gap-14 pb-20 pt-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center`}>
          <div>
            <p data-a="sub" className="font-mono text-xs uppercase tracking-[0.18em] text-graphite">
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
              <Link href="/vendor/start" className={buttonClass()}>
                Send your first invoice
              </Link>
              <Link href="/setup" className={buttonClass({ variant: "secondary" })}>
                Set up your business
              </Link>
            </div>
          </div>

          <div className="relative flex min-w-0" aria-hidden>
            <div data-a="left" className="w-1/2 min-w-0 drop-shadow-[0_18px_30px_rgba(21,33,28,0.12)]">
              <Half side="vendor" fingerprint={FP} className="h-[330px] bg-paper-raised" tone="var(--seal)">
                <div className="px-4 py-7 pr-9 sm:px-6 sm:pr-11">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">The vendor’s half</p>
                  <p className="mt-2 font-display text-2xl">Verified Vendor</p>
                  <SealStamp handle="@vendor" size={52} className="mt-4 rotate-[-6deg]" />
                  <p className="mt-5 text-sm text-graphite">Invoice 0001 · $2,000.00 USDC</p>
                </div>
              </Half>
            </div>
            <div data-a="right" className="-ml-[22px] w-[calc(50%+22px)] min-w-0 drop-shadow-[0_18px_30px_rgba(21,33,28,0.12)]">
              <Half side="payer" fingerprint={FP} className="h-[330px] bg-paper-raised" tone="var(--seal)">
                <div className="px-4 py-7 pl-9 sm:px-6 sm:pl-11">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">The payer’s half</p>
                  <p className="mt-2 font-display text-2xl">Your Business</p>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    <li>✓ Order PO-0001</li>
                    <li>✓ Delivered on time</li>
                    <li>✓ Within policy limits</li>
                  </ul>
                </div>
              </Half>
            </div>
            <div data-a="stamp" className="absolute left-1/2 top-[74%] -translate-x-1/2 rotate-[-9deg] rounded-sm border-2 border-seal bg-paper-raised/90 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-seal">
              Matched
            </div>
          </div>
        </section>

        <NetworkNumbers />
        <section className="border-y border-rule bg-paper-raised/50" aria-label="Use cases">
          <div className={`${CONTAINER} grid gap-10 py-16 md:grid-cols-3`}>
            {([
              ["For freelancers", "Send invoices with cryptographic proof, get paid in seconds on Arc testnet, and accept Early Pay discounts when you choose.", "/vendor/start", "Start as a vendor"],
              ["For founders and ops", "An AI Steward that runs your payables within onchain limits, and cannot pay an unconfirmed or changed address.", "/setup", "Set up your business"],
              ["For finance", "Every payment points at an EIP-712 sealed document, matched delivery, and an append-only recorded decision.", "/verify", "Verify an invoice"],
            ] as const).map(([t, d, href, cta]) => (
              <div key={t} className="flex flex-col justify-between">
                <div>
                  <h2 className="font-display text-3xl">{t}</h2>
                  <p className="mt-3 text-graphite">{d}</p>
                </div>
                <Link href={href} className="mt-4 inline-block underline decoration-rule underline-offset-4 hover:text-ink">
                  {cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className={`${CONTAINER} grid gap-12 py-20 lg:grid-cols-2`}>
          <div>
            <h2 className="font-display text-4xl md:text-5xl leading-none">The name is the idea.</h2>
            <p className="mt-5 max-w-[52ch] text-lg text-graphite leading-relaxed">
              A <em className="font-serif italic text-ink">symbolon</em> was an ancient Greek object broken in two; each party kept a half, and an agreement was proven when the halves fitted together.
              Here the vendor’s sealed invoice is one half, and the payer’s order and delivery confirmation are the other. Both are cut from the
              invoice’s unique cryptographic fingerprint, so only the authentic pair fits.
            </p>
          </div>
          <div>
            <h2 className="font-display text-2xl md:text-3xl">What the Steward can’t do, however it’s asked</h2>
            <ul className="mt-5 border-t border-ink" aria-label="Steward hard limits">
              {CANNOT_ITEMS.map((c) => (
                <li key={c} className="flex gap-3 border-b border-rule py-3 text-sm md:text-base">
                  <span className="text-red font-mono" aria-hidden>
                    ✕
                  </span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-graphite">These limits live in each business’s Vault smart contract onchain, not in the Steward’s model instructions.</p>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
