"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Wordmark } from "@/components/Marks";
import { D, E, registerMotion, resolveText } from "@/lib/motion";

const steps = ["Sign in", "Your Seal", "Getting paid", "Check"] as const;

/** Vendor sign-up (A1 + V1): email, a Seal, payout preferences, screening. No seed phrase, no gas token. */
export function Onboarding() {
  const [i, setI] = useState(0);
  const [email, setEmail] = useState("ana@studio-ana.com");
  const [name, setName] = useState("Studio Ana");
  const [handle, setHandle] = useState("studio-ana");
  const [currency, setCurrency] = useState<"USDC" | "EURC">("USDC");
  const [chain, setChain] = useState("Arc");
  const [own, setOwn] = useState(false);
  const [addr, setAddr] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  // Each step arrives from the right along the track (storyboard: seal-and-join, beat 5)
  useLayoutEffect(() => {
    if (!panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from(panel.current, { x: 24, opacity: 0, duration: D.base, ease: E("arrive") });
      if (i === 3) resolveText(tl, panel.current!.querySelector("[data-a=wallet]"), 0.1);
    }, panel);
    return () => ctx.revert();
  }, [i]);

  const input = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none";
  const taken = handle === "studio";
  const validAddr = !own || /^0x[0-9a-fA-F]{40}$/.test(addr);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Wordmark />
        <Link href="/v" className="text-sm text-graphite underline decoration-rule underline-offset-4">
          Skip to the app (demo)
        </Link>
      </header>
      <main className="mx-auto max-w-[980px] px-6 pb-24 pt-12">
        <ol className="relative flex justify-between" aria-label="Steps">
          <div className="absolute left-3 right-3 top-3 h-px bg-rule" />
          <div className="absolute left-3 top-3 h-0.5 bg-seal transition-[width] duration-[var(--dur-arrive)]" style={{ width: `calc(${(i / (steps.length - 1)) * 100}% - 1.5rem)` }} />
          {steps.map((s, k) => (
            <li key={s} className="relative z-10 flex flex-col items-center gap-2 text-sm" aria-current={k === i ? "step" : undefined}>
              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 bg-paper text-xs ${k <= i ? "border-seal text-seal" : "border-rule text-graphite"}`}>
                {k < i ? "✓" : k + 1}
              </span>
              <span className={k === i ? "" : "text-graphite"}>{s}</span>
            </li>
          ))}
        </ol>

        <div ref={panel} key={i} className="mt-14 max-w-xl">
          {i === 0 ? (
            <form onSubmit={(e) => (e.preventDefault(), setI(1))}>
              <h1 className="font-display text-5xl leading-none">Invoice for free. Get paid in seconds.</h1>
              <p className="mt-3 text-graphite">Sign in with your email. We make you a wallet behind the scenes: no seed phrase, and you never need a gas token.</p>
              <label className="mt-8 block text-sm">
                Email
                <input type="email" required className={input} value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button className="rounded-doc bg-ink px-5 py-3 font-medium text-paper">Continue with email</button>
                <button type="button" onClick={() => setI(1)} className="text-sm underline decoration-rule underline-offset-4">
                  Use my own wallet instead
                </button>
              </div>
            </form>
          ) : null}

          {i === 1 ? (
            <form onSubmit={(e) => (e.preventDefault(), !taken && setI(2))}>
              <h1 className="font-display text-5xl leading-none">Your Seal</h1>
              <p className="mt-3 text-graphite">Every invoice you send carries it. Clients verify it once, then trust every invoice it signs.</p>
              <label className="mt-8 block text-sm">
                Name on your invoices
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="mt-5 block text-sm">
                Handle
                <span className="mt-1 flex items-center rounded-doc border border-rule bg-paper focus-within:border-ink">
                  <span className="pl-3 text-graphite">symbolon.xyz/@</span>
                  <input className="w-full bg-transparent py-2.5 pr-3 focus:outline-none" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                </span>
              </label>
              <p className={`mt-2 text-sm ${taken ? "text-red" : "text-seal"}`}>{taken ? "That handle is taken." : `@${handle} is yours.`}</p>
              <button disabled={taken || !handle} className="mt-6 rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40">
                Continue
              </button>
            </form>
          ) : null}

          {i === 2 ? (
            <form onSubmit={(e) => (e.preventDefault(), validAddr && setI(3))}>
              <h1 className="font-display text-5xl leading-none">How you get paid</h1>
              <p className="mt-3 text-graphite">You can change this per client later. Changes are signed by your Seal and your clients confirm them.</p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Currency
                  <span className="mt-1 flex overflow-hidden rounded-doc border border-rule">
                    {(["USDC", "EURC"] as const).map((k) => (
                      <button type="button" key={k} aria-pressed={currency === k} onClick={() => setCurrency(k)} className={`flex-1 py-2.5 ${currency === k ? "bg-ink text-paper" : ""}`}>
                        {k}
                      </button>
                    ))}
                  </span>
                </label>
                <label className="text-sm">
                  Chain
                  <select className={`${input} disabled:opacity-60`} disabled={currency === "EURC"} value={currency === "EURC" ? "Arc" : chain} onChange={(e) => setChain(e.target.value)}>
                    {["Arc", "Base", "Ethereum", "Arbitrum", "Solana"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              {currency === "EURC" ? <p className="mt-2 text-xs text-graphite">EURC is paid on Arc.</p> : null}
              <fieldset className="mt-6 space-y-2 text-sm">
                <legend className="mb-1">Pay to</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!own} onChange={() => setOwn(false)} /> My Symbolon wallet (made for you)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={own} onChange={() => setOwn(true)} /> An address I already have
                </label>
                {own ? (
                  <>
                    <input aria-label="Payout address" className={`${input} font-mono text-sm`} placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
                    {addr && !validAddr ? <p className="text-red">That isn’t a valid address. It should be 0x followed by 40 characters.</p> : null}
                  </>
                ) : null}
              </fieldset>
              <button disabled={!validAddr || (own && !addr)} className="mt-6 rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40">
                Continue
              </button>
            </form>
          ) : null}

          {i === 3 ? (
            <div>
              <h1 className="font-display text-5xl leading-none">You’re ready, {name.split(" ")[0]}.</h1>
              <dl className="mt-8 space-y-3 border-t border-ink pt-4">
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Seal</dt>
                  <dd>@{handle}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Paid in</dt>
                  <dd>
                    {currency} on {currency === "EURC" ? "Arc" : chain}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">To</dt>
                  <dd data-a="wallet" className="font-mono">
                    {own ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "0x7a3f…c219"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-graphite">Screening</dt>
                  <dd className="text-seal">✓ Low risk, checked just now</dd>
                </div>
              </dl>
              <div className="mt-8 flex gap-3">
                <Link href="/v/new" className="rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                  Send your first invoice
                </Link>
                <Link href="/v" className="rounded-doc border border-rule px-5 py-3">
                  Go to Home
                </Link>
              </div>
            </div>
          ) : null}

          {i > 0 && i < 3 ? (
            <button onClick={() => setI(i - 1)} className="mt-6 block text-sm text-graphite underline decoration-rule underline-offset-4">
              Back
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
