"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { DemoTag, SealStamp, Wordmark } from "@/components/Marks";
import { Scatter } from "@/components/Scatter";
import { TxLink } from "@/components/TxLink";
import { D, E, registerMotion, strike } from "@/lib/motion";
import { tx } from "@/lib/tx";

type Result = "genuine" | "modified" | "unsealed";

const genuineFp = "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308";
const modifiedFp = "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f309";

/** The public verify page (P2): genuine, modified or unsealed, and whether it was paid. Runs in the browser. */
export function Verify() {
  const [result, setResult] = useState<Result | null>(null);
  const [link, setLink] = useState("");
  const out = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!result || !out.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from("[data-a=verdict]", { opacity: 0, filter: "blur(10px)", y: 8, duration: D.move, ease: E("arrive") }, 0);
      if (result === "genuine") strike(tl, "[data-a=stamp]", 0.3);
      if (result !== "genuine") {
        tl.from('[data-frag="letter"]', { x: 0, y: 0, rotation: 0, opacity: 0.8, duration: D.cinematic, ease: E("settle"), stagger: { each: 0.035, from: "end" } }, 0.2);
        tl.from('[data-frag="dust"]', { x: -30, opacity: 0, duration: D.cinematic, ease: E("settle"), stagger: { each: 0.012, from: "random" } }, 0.3);
      }
      tl.from("[data-a=row]", { opacity: 0, y: 8, duration: D.base, ease: E("arrive"), stagger: 0.07 }, 0.35);
    }, out);
    return () => ctx.revert();
  }, [result]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10">
        <Link href="/">
          <Wordmark />
        </Link>
        <DemoTag />
      </header>
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-14 md:px-10">
        <h1 className="max-w-[18ch] font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-[1.02]">Is this invoice genuine, and has it been paid?</h1>
        <p className="mt-4 max-w-[62ch] text-graphite">
          Drop an invoice file or paste its link. The check runs in your browser against the public ledger on Arc. Nothing is uploaded.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section aria-label="Check an invoice" className="space-y-5">
            <div className="grid place-items-center rounded-doc border-2 border-dashed border-rule px-6 py-14 text-center">
              <p>Drop an invoice file here</p>
              <p className="mt-1 text-sm text-graphite">PDF or .symbolon file</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (link.trim()) setResult("genuine");
              }}
              className="flex gap-2"
            >
              <input
                aria-label="Invoice link"
                required
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="symbolon.xyz/i/…"
                className="w-full rounded-doc border border-rule bg-paper px-3 py-2.5 font-mono text-sm focus:border-ink focus:outline-none"
              />
              <button className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">Check</button>
            </form>
            <div>
              <p className="text-sm text-graphite">Or try a sample</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ["genuine", "A genuine, paid invoice"],
                    ["modified", "One changed after sealing"],
                    ["unsealed", "An unsealed PDF"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setResult(k)}
                    aria-pressed={result === k}
                    className={`rounded-full border px-3 py-1.5 text-sm ${result === k ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section ref={out} aria-live="polite" aria-label="Result">
            {!result ? (
              <p className="rounded-doc border border-rule p-8 text-graphite">The result appears here: who sealed it, whether it’s been changed, and whether it’s been paid.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] sm:gap-x-24">
                <div className="relative">
                  <Half
                    side="vendor"
                    fingerprint={result === "genuine" ? genuineFp : modifiedFp}
                    className="bg-paper-raised"
                    tone={result === "genuine" ? "var(--seal)" : "var(--red)"}
                    seamClassName={result === "genuine" ? "" : "opacity-0"}
                  >
                    <div className="px-6 py-7 pr-12">
                      <p className="font-display text-2xl leading-none">Studio Ana</p>
                      <p className="mt-1 font-mono text-xs text-graphite">Invoice 0143</p>
                      {result === "unsealed" ? (
                        <p className="mt-4 grid h-14 w-14 place-items-center rounded-full border-2 border-dashed border-red/60 text-center text-[10px] leading-tight text-red">no Seal</p>
                      ) : (
                        <div data-a="stamp" className="mt-4 w-fit">
                          <SealStamp handle="@studio-ana" size={56} className="rotate-[-6deg]" />
                        </div>
                      )}
                      <p className="mt-4 flex justify-between border-t border-rule pt-3 text-sm">
                        <span className="text-graphite">Total</span>
                        <span className={result === "modified" ? "text-red" : ""}>{result === "modified" ? "2,900.00 USDC" : "2,000.00 USDC"}</span>
                      </p>
                    </div>
                  </Half>
                  {result !== "genuine" ? (
                    <div className="absolute inset-y-0 right-0 w-20 translate-x-full overflow-hidden">
                      <Scatter text={modifiedFp.slice(2, 18).toUpperCase()} />
                    </div>
                  ) : null}
                </div>

                <div>
                  <p data-a="verdict" className={`font-display text-4xl leading-tight ${result === "genuine" ? "text-seal" : "text-red"}`}>
                    {result === "genuine" ? "Genuine, and paid." : result === "modified" ? "Changed after it was sealed." : "Not sealed."}
                  </p>
                  <dl className="mt-5 space-y-3 text-sm">
                    {(result === "genuine"
                      ? [
                          ["Sealed by", "Studio Ana (@studio-ana), domain studio-ana.com verified"],
                          ["Contents", "Match the Seal’s signature exactly"],
                          ["Paid", "$1,985.00 of $2,000.00 on 28 Sep, 09:12, with a 0.75% early-payment discount the vendor signed"],
                          ["By", "Acme Operations’ Vault"],
                          ["Proof", "tx"],
                        ]
                      : result === "modified"
                        ? [
                            ["Contents", "Don’t match the signature: something in this file was changed after Studio Ana sealed it"],
                            ["What to do", "Don’t pay it. Ask Studio Ana for the invoice through Symbolon, or check the original link"],
                            ["Can it be paid?", "No. A Vault only pays an invoice whose signature matches its contents"],
                          ]
                        : [
                            ["Seal", "None. Anyone can make a PDF that looks like this"],
                            ["What to do", "Ask the vendor to send it sealed. If they’re on Symbolon, that takes them one click"],
                          ]
                    ).map(([k, v]) => (
                      <div key={k} data-a="row" className="border-b border-rule pb-3">
                        <dt className="text-graphite">{k}</dt>
                        <dd className="mt-0.5">
                          {k === "Proof" ? (
                            <>
                              Transaction <TxLink hash={tx.payAna}>{tx.payAna}</TxLink> on Arc
                            </>
                          ) : (
                            v
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-4 text-xs text-graphite">Checked in your browser. Nothing was uploaded.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
