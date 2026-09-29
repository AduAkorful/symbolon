"use client";

import Link from "next/link";
import { useState } from "react";
import { DemoTag, Wordmark } from "@/components/Marks";

/** Sign in (A1): email with an embedded wallet made behind the scenes, or an existing wallet; then pick a space (A2) */
export default function SignIn() {
  const [step, setStep] = useState<"email" | "code" | "spaces">("email");
  const [email, setEmail] = useState("ana@studio-ana.com");
  const [code, setCode] = useState("");
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Link href="/">
          <Wordmark />
        </Link>
        <DemoTag />
      </header>
      <main className="mx-auto max-w-md px-6 pb-24 pt-20">
        {step === "email" ? (
          <form onSubmit={(e) => (e.preventDefault(), setStep("code"))}>
            <h1 className="font-display text-5xl leading-none">Sign in</h1>
            <p className="mt-3 text-graphite">With your email, or a wallet you already use.</p>
            <label className="mt-8 block text-sm">
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none" />
            </label>
            <button className="mt-5 w-full rounded-doc bg-ink py-3 font-medium text-paper">Email me a code</button>
            <div className="my-6 flex items-center gap-3 text-sm text-graphite">
              <span className="h-px flex-1 bg-rule" /> or <span className="h-px flex-1 bg-rule" />
            </div>
            <button type="button" onClick={() => setStep("spaces")} className="w-full rounded-doc border border-rule py-3 hover:border-ink">
              Connect a wallet
            </button>
            <p className="mt-6 text-center text-sm text-graphite">
              New here?{" "}
              <Link href="/v/start" className="underline decoration-rule underline-offset-4">
                Start as a vendor
              </Link>{" "}
              or{" "}
              <Link href="/setup" className="underline decoration-rule underline-offset-4">
                set up a business
              </Link>
              .
            </p>
          </form>
        ) : step === "code" ? (
          <form onSubmit={(e) => (e.preventDefault(), code.length === 6 && setStep("spaces"))}>
            <h1 className="font-display text-5xl leading-none">Check your email</h1>
            <p className="mt-3 text-graphite">We sent a 6-digit code to {email}. It works for 10 minutes.</p>
            <input
              aria-label="Code"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="mt-8 w-full rounded-doc border border-rule bg-paper px-3 py-3 text-center font-mono text-3xl tracking-[0.5em] focus:border-ink focus:outline-none"
            />
            <button disabled={code.length !== 6} className="mt-5 w-full rounded-doc bg-ink py-3 font-medium text-paper disabled:opacity-40">
              Sign in
            </button>
            <p className="mt-3 text-center text-xs text-graphite">Any 6 digits work in this prototype.</p>
          </form>
        ) : (
          <div>
            <h1 className="font-display text-5xl leading-none">Where to?</h1>
            <ul className="mt-8 space-y-3">
              {[
                { href: "/v", mark: "S", name: "Studio Ana", role: "Your Seal · invoices you send" },
                { href: "/b", mark: "A", name: "Acme Operations", role: "Owner · bills you pay" },
              ].map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="flex items-center gap-4 rounded-doc border border-rule p-4 hover:border-ink">
                    <span className="grid h-9 w-9 place-items-center rounded-sm bg-ink font-display text-lg text-paper">{s.mark}</span>
                    <span>
                      <span className="block font-medium">{s.name}</span>
                      <span className="block text-sm text-graphite">{s.role}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
