"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import { Wordmark } from "@/components/Marks";
import { postJson } from "@/lib/client/api";
import { D, E, registerMotion } from "@/lib/motion";

const steps = ["Your Seal", "Getting paid"] as const;
const input = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none";
const primary = "rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40";

/** Vendor sign-up (V1): the Seal is your own wallet; pick a handle and the name on your invoices, then where new invoices pay out. Plan 05i. */
export function Onboarding({ wallet, next = "/vendor" }: { wallet: string | null; next?: string }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<{ ok: boolean; reason?: string } | "checking" | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const t = gsap.from(panel.current, { x: 24, opacity: 0, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [i]);

  // Ask whether the handle is free once they stop typing
  useEffect(() => {
    if (!handle) {
      setAvail(null);
      return;
    }
    setAvail("checking");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/vendor/seal?handle=${encodeURIComponent(handle)}`, { cache: "no-store" });
        setAvail(r.ok ? ((await r.json()) as { ok: boolean; reason?: string }) : null);
      } catch {
        setAvail(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [handle]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await postJson("/api/vendor/seal", { handle, displayName: name, website });
      setI(1);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      if (payout.trim()) await postJson("/api/vendor/settings", { payoutAddress: payout });
      router.push(next);
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Link href="/" aria-label="Symbolon home">
          <Wordmark />
        </Link>
        <Link href="/business" className="text-sm text-graphite underline decoration-rule underline-offset-4">
          Back to the app
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

        <div ref={panel} key={i} className="mt-14 max-w-xl">
          {i === 0 ? (
            <form onSubmit={register}>
              <h1 className="font-display text-5xl leading-none">Invoice for free. Get paid in seconds.</h1>
              <p className="mt-3 text-graphite">
                Your Seal is your wallet’s signature on every invoice you send. Anyone can check that an invoice is really yours, and that nobody changed it.
              </p>
              {wallet ? (
                <p className="mt-4 text-sm text-graphite">
                  Your Seal is the wallet <span className="break-all font-mono">{wallet}</span>.
                </p>
              ) : (
                <p role="status" className="mt-4 rounded-doc border border-rule p-4 text-sm text-graphite">
                  This account has no wallet to hold a Seal. Sign in with a wallet to register one.
                </p>
              )}
              <label className="mt-8 block text-sm">
                Handle
                <input className={`${input} font-mono`} value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} required minLength={3} maxLength={40} autoCapitalize="none" spellCheck={false} aria-describedby="handle-note" />
              </label>
              <p id="handle-note" className="mt-1 text-xs text-graphite" aria-live="polite">
                {avail === "checking" ? "Checking…" : avail ? (avail.ok ? "✓ Available" : avail.reason) : "Lowercase letters, digits and hyphens. It appears on your invoices as @handle."}
              </p>
              <label className="mt-6 block text-sm">
                The name on your invoices
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
              </label>
              <label className="mt-6 block text-sm">
                Website, if you have one
                <input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} placeholder="studio-ana.com" />
              </label>
              {problem ? (
                <p role="alert" className="mt-4 text-sm text-red">
                  {problem}
                </p>
              ) : null}
              <button disabled={busy || !wallet || (avail !== null && avail !== "checking" && !avail.ok)} className={`mt-8 ${primary}`}>
                {busy ? "Registering…" : "Register my Seal"}
              </button>
            </form>
          ) : (
            <form onSubmit={finish}>
              <h1 className="font-display text-5xl leading-none">Where should you be paid?</h1>
              <p className="mt-3 text-graphite">New invoices pay out on Arc to your wallet unless you say otherwise. You can change this later; every invoice shows the address it was signed with.</p>
              <label className="mt-8 block text-sm">
                Payout address on Arc, if not your wallet
                <input className={`${input} font-mono`} value={payout} onChange={(e) => setPayout(e.target.value)} placeholder={wallet ?? "0x…"} spellCheck={false} />
              </label>
              {problem ? (
                <p role="alert" className="mt-4 text-sm text-red">
                  {problem}
                </p>
              ) : null}
              <button disabled={busy} className={`mt-8 ${primary}`}>
                {busy ? "Saving…" : "Done"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
