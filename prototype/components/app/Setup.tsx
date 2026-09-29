"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Wordmark } from "@/components/Marks";
import { TxLink } from "@/components/TxLink";
import { D, E, registerMotion, resolveText, roll } from "@/lib/motion";
import { VAULT_ADDRESS, tx } from "@/lib/tx";

const steps = ["Business", "Vault", "Policy", "Fund"] as const;

const templates = [
  {
    key: "starter",
    name: "Starter",
    body: "A founder paying a handful of vendors. Fewer people in the loop; every onchain guard still on.",
    rules: ["Auto-pay up to $1,000.00 for verified vendors", "Owner signs above $10,000.00", "Loosening changes wait 24 hours"],
  },
  {
    key: "standard",
    name: "Standard",
    body: "A team with budgets and approvers. The spec’s example policy.",
    rules: ["Auto-pay up to $1,000.00 after 3 paid invoices", "Approver $1,000–10,000; owner above", "Screening within 30 days"],
  },
  {
    key: "strict",
    name: "Strict",
    body: "Lower limits and longer delays. Every new vendor’s first five invoices go to a person.",
    rules: ["Auto-pay up to $250.00", "Owner signs above $5,000.00", "Loosening changes wait 72 hours"],
  },
] as const;

/** Setting up a business (B1–B3): name and team, the Vault, a policy template, and funding it */
export function Setup() {
  const [i, setI] = useState(0);
  const [name, setName] = useState("Acme Operations");
  const [method, setMethod] = useState<"wallet" | "passkey" | "multi">("wallet");
  const [created, setCreated] = useState(false);
  const [tpl, setTpl] = useState<(typeof templates)[number]["key"]>("standard");
  const [source, setSource] = useState("Base");
  const [amount, setAmount] = useState("10000");
  const [funded, setFunded] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    if (!panel.current || reduce()) return;
    registerMotion();
    const t = gsap.from(panel.current, { x: 24, opacity: 0, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [i]);

  // The Vault's address resolves; the balance counts up (storyboard: seal-and-join, beat 5)
  const out = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!out.current || reduce() || (!created && !funded)) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      if (created && i === 1) resolveText(tl, out.current!.querySelector("[data-a=addr]"), 0);
      if (funded && i === 3) roll(tl, out.current!.querySelector("[data-a=bal]"), 0, 0, 0.8);
    }, out);
    return () => ctx.revert();
  }, [created, funded, i]);

  const input = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Link href="/">
          <Wordmark />
        </Link>
        <Link href="/b" className="text-sm text-graphite underline decoration-rule underline-offset-4">
          Skip to the app (demo)
        </Link>
      </header>
      <main className="mx-auto max-w-[980px] px-6 pb-24 pt-12">
        <ol className="relative flex justify-between" aria-label="Steps">
          <div className="absolute left-3 right-3 top-3 h-px bg-rule" />
          <div className="absolute left-3 top-3 h-0.5 bg-seal transition-[width] duration-[var(--dur-arrive)]" style={{ width: `calc(${(i / (steps.length - 1)) * 100}% - 1.5rem)` }} />
          {steps.map((s, k) => (
            <li key={s} className="relative z-10 flex flex-col items-center gap-2 text-sm" aria-current={k === i ? "step" : undefined}>
              <span className={`grid h-6 w-6 place-items-center rounded-full border-2 bg-paper text-xs ${k <= i ? "border-seal text-seal" : "border-rule text-graphite"}`}>{k < i ? "✓" : k + 1}</span>
              <span className={k === i ? "" : "text-graphite"}>{s}</span>
            </li>
          ))}
        </ol>

        <div ref={panel} key={i} className="mt-14">
          <div ref={out}>
            {i === 0 ? (
              <form onSubmit={(e) => (e.preventDefault(), setI(1))} className="max-w-xl">
                <h1 className="font-display text-5xl leading-none">Set up your business</h1>
                <p className="mt-3 text-graphite">Your Steward pays sealed invoices from your Vault, within rules you set. You can start in shadow mode, where it only shows what it would do.</p>
                <label className="mt-8 block text-sm">
                  Business name
                  <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label className="mt-5 block text-sm">
                  Invite your team (optional)
                  <input className={input} placeholder="ama@acme.example (approver), dele@acme.example (requester)" />
                </label>
                <button className="mt-6 rounded-doc bg-ink px-5 py-3 font-medium text-paper">Continue</button>
              </form>
            ) : null}

            {i === 1 ? (
              <div className="max-w-2xl">
                <h1 className="font-display text-5xl leading-none">Your Vault</h1>
                <p className="mt-3 text-graphite">
                  A contract on Arc that holds your funds and enforces your rules. It’s yours: only its owner can change the rules, upgrade it or withdraw.
                </p>
                <fieldset className="mt-8">
                  <legend className="text-sm">Who approves as the owner</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["wallet", "A wallet", "The one you signed in with"],
                        ["passkey", "A passkey", "Face or fingerprint on this device"],
                        ["multi", "Several owners", "Two of three must sign"],
                      ] as const
                    ).map(([k, t, d]) => (
                      <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)} className={`rounded-doc border p-4 text-left ${method === k ? "border-ink bg-paper-raised" : "border-rule hover:border-ink/50"}`}>
                        <span className="block font-medium">{t}</span>
                        <span className="text-sm text-graphite">{d}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {created ? (
                  <div className="mt-8 border-t border-ink pt-4">
                    <p className="text-sm text-graphite">Your Vault on Arc</p>
                    <p data-a="addr" className="font-mono text-2xl">
                      0x5f5e…2984
                    </p>
                    <p className="mt-2 flex flex-wrap gap-x-4 text-sm text-graphite">
                      <TxLink hash={tx.createVault}>Created in transaction {tx.createVault}</TxLink>
                      <TxLink kind="address" hash={VAULT_ADDRESS}>View the Vault on the explorer</TxLink>
                    </p>
                    <button onClick={() => setI(2)} className="mt-6 rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                      Continue
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setCreated(true)} className="mt-8 rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                    Create the Vault (one signature)
                  </button>
                )}
              </div>
            ) : null}

            {i === 2 ? (
              <div>
                <h1 className="font-display text-5xl leading-none">Start from a policy</h1>
                <p className="mt-3 max-w-[60ch] text-graphite">Every rule is editable later. Tightening applies at once; loosening waits, so a stolen session can’t widen limits and pay out in the same minute.</p>
                <div role="radiogroup" className="mt-8 grid gap-4 md:grid-cols-3">
                  {templates.map((t) => (
                    <button key={t.key} role="radio" aria-checked={tpl === t.key} onClick={() => setTpl(t.key)} className={`rounded-doc border p-5 text-left ${tpl === t.key ? "border-ink bg-paper-raised" : "border-rule hover:border-ink/50"}`}>
                      <span className="font-display text-3xl">{t.name}</span>
                      <span className="mt-2 block text-sm text-graphite">{t.body}</span>
                      <ul className="mt-4 space-y-1 border-t border-rule pt-3 text-sm">
                        {t.rules.map((r) => (
                          <li key={r}>· {r}</li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                <button onClick={() => setI(3)} className="mt-8 rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                  Use {templates.find((t) => t.key === tpl)!.name}
                </button>
              </div>
            ) : null}

            {i === 3 ? (
              <div className="grid gap-12 lg:grid-cols-2">
                <div>
                  <h1 className="font-display text-5xl leading-none">Fund it</h1>
                  <p className="mt-3 text-graphite">Deposit USDC from any chain you already hold it on; it arrives as one balance in your Vault on Arc.</p>
                  <div className="mt-8 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">
                      From
                      <select className={input} value={source} onChange={(e) => setSource(e.target.value)}>
                        {["Base", "Ethereum", "Arbitrum", "Arc", "Solana"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      Amount (USDC)
                      <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
                    </label>
                  </div>
                  <p className="mt-3 text-sm text-graphite">Network fee about $0.01, paid in USDC. No gas token needed.</p>
                  {!funded ? (
                    <button disabled={!(Number(amount) > 0)} onClick={() => setFunded(true)} className="mt-6 rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40">
                      Deposit ${Number(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </button>
                  ) : null}
                  <p className="mt-8 text-sm text-graphite">
                    Paying vendors in euros? Convert some USDC to EURC after funding, from Treasury. Your Vault never converts on its own.
                  </p>
                </div>
                <div className="lg:pt-24">
                  <p className="text-sm text-graphite">{name}’s Vault holds</p>
                  <p data-a="bal" className="font-display text-7xl leading-none">
                    ${funded ? Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "0.00"}
                  </p>
                  {funded ? (
                    <div className="mt-8 space-y-3">
                      <p className="text-seal">✓ Arrived on Arc</p>
                      <TxLink hash={tx.fund}>Deposit transaction {tx.fund}</TxLink>
                      <Link href="/b" className="inline-block rounded-doc bg-ink px-5 py-3 font-medium text-paper">
                        Open {name}
                      </Link>
                      <p className="text-sm text-graphite">Your Steward starts in shadow mode. Switch it on from the Steward page when you’re ready.</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {i > 0 ? (
            <button onClick={() => setI(i - 1)} className="mt-8 block text-sm text-graphite underline decoration-rule underline-offset-4">
              Back
            </button>
          ) : null}
        </div>
      </main>
    </div>
  );
}
