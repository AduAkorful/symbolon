"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import { Wordmark } from "@/components/Marks";
import { postJson } from "@/lib/client/api";
import { D, E, registerMotion } from "@/lib/motion";
import { Address } from "@/components/Address";
import { PageTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "./seal-signer";
import type { SignerPlan } from "@/components/setup/owner-signer";

const steps = ["Your Seal", "Getting paid"] as const;
const input = controlClass;
const primary = "rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40";

/** Vendor sign-up (V1): the Seal is your own wallet; pick a handle and the name on your invoices, then where new invoices pay out. Plan 05i. */
export function Onboarding({ wallet, signer, next = "/vendor" }: { wallet: string | null; signer: SignerPlan; next?: string }) {
  const router = useRouter();
  const discover = useWalletProviders();
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
    // a handle that can't be one is said at once, without asking the server (QA NEW-10)
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(handle)) {
      setAvail(handle.length < 3 ? null : { ok: false, reason: "Use 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit." });
      return;
    }
    setAvail("checking");
    // an answer that arrives after the handle changed again is for a handle that is no longer there (plan 05zj F, SYM-46)
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/vendor/seal?handle=${encodeURIComponent(handle)}`, { cache: "no-store" });
        const answer = r.ok ? ((await r.json()) as { ok: boolean; reason?: string }) : null;
        if (!stale) setAvail(answer);
      } catch {
        if (!stale) setAvail(null);
      }
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [handle]);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      // the wallet signs the exact text the server built; the Seal is saved only with that signature (plan 05zo)
      const prepared = await postJson<{ typedData: string; issuedAt: number }>("/api/vendor/seal", { action: "prepare", handle, displayName: name, website });
      const signature = await signTypedData(signer, prepared.typedData, discover);
      await postJson("/api/vendor/seal", { action: "register", handle, displayName: name, website, issuedAt: prepared.issuedAt, signature });
      setI(1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      // a refusal about the handle belongs under the handle, once; anything else is said at the foot of the form
      if (/handle/i.test(message)) {
        setAvail({ ok: false, reason: message });
        setProblem(null);
      } else {
        setProblem(message);
      }
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
        <Link href="/signin" className="text-sm text-graphite underline decoration-rule underline-offset-4">
          Back
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
              <PageTitle>Invoice for free. Get paid in seconds.</PageTitle>
              <p className="mt-3 text-graphite">
                Your Seal is your wallet’s signature on every invoice you send. Anyone can check that an invoice is really yours, and that nobody changed it.
              </p>
              {wallet ? (
                <>
                  <p className="mt-4 text-sm text-graphite">
                    Your Seal is the wallet <Address value={wallet} full />, the one you signed in with. Registering asks that wallet to sign your handle and name, so they are yours and not just a record on our server.
                  </p>
                  <p className="mt-2 text-sm text-graphite">
                    The name and handle below are what businesses see. They don’t prove who you are: a business checks that for itself before it adds you as a payee.
                  </p>
                </>
              ) : (
                <p role="status" className="mt-4 rounded-doc border border-rule p-4 text-sm text-graphite">
                  This account has no wallet to hold a Seal. Sign in with a wallet to register one.
                </p>
              )}
              <label className="mt-8 block text-sm">
                Handle
                <input className={`${input} font-mono`} value={handle} onChange={(e) => { setHandle(e.target.value.toLowerCase()); setProblem(null); }} required minLength={3} maxLength={40} autoCapitalize="none" spellCheck={false} aria-describedby="handle-note" aria-invalid={avail && avail !== "checking" && !avail.ok ? true : undefined} />
              </label>
              <p id="handle-note" className={`mt-1 text-xs ${avail && avail !== "checking" && !avail.ok ? "text-red" : "text-graphite"}`} aria-live="polite">
                {avail === "checking" ? "Checking…" : avail ? (avail.ok ? "✓ Available" : avail.reason) : "Lowercase letters, digits and hyphens. It appears on your invoices as @handle."}
              </p>
              <p className="mt-1 text-xs text-graphite">Handles are always lowercase, so capitals are changed as you type.</p>
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
                {busy ? "Waiting for your wallet…" : "Sign and register my Seal"}
              </button>
            </form>
          ) : (
            <form onSubmit={finish}>
              <PageTitle>Where should you be paid?</PageTitle>
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
