"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { TxLink } from "@/components/TxLink";
import { D, E, registerMotion } from "@/lib/motion";
import { tx } from "@/lib/tx";
import { useRelease } from "./release";

const changes = ["Clearer reasons when the Vault refuses a payment, in the record you can export."];
const unchanged = [
  "Payees, budgets, approvals and policy",
  "Balances and every past payment",
  "The Steward’s permissions",
  "Your reserve settings and your 24-hour delay",
];

/** The release awaiting the owner: notes, schedule, wait, apply (B23). Every state keeps the same footprint. */
export function ReleaseCard() {
  const { state, remaining, fraction, schedule, cancel, apply, skipWait } = useRelease();
  const [signing, setSigning] = useState<"schedule" | "apply" | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // The card changes state when the owner acts; the new state arrives rather than snapping
  useLayoutEffect(() => {
    if (!box.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      gsap.from("[data-state]", { opacity: 0, y: 8, duration: D.base, ease: E("arrive") });
    }, box);
    return () => ctx.revert();
  }, [state, signing]);

  if (state === "applied") {
    return (
      <div ref={box} className="mt-5 rounded-doc border border-seal/50 bg-seal-wash/50 p-4" role="status">
        <div data-state>
          <p className="font-medium">Release 3 is live on your Vault</p>
          <p className="mt-1 text-sm text-graphite">
            Symbolon read your Vault’s payees, budgets, policy and balances before and after the upgrade, and they match. Payments continue on the same rules.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-graphite">
            <TxLink hash={tx.upgradeSchedule}>Scheduled in {tx.upgradeSchedule}</TxLink>
            <TxLink hash={tx.upgradeApply}>Applied in {tx.upgradeApply}</TxLink>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={box} className="mt-5 rounded-doc border border-rule bg-paper-raised p-4">
      <div data-state key={`${state}-${signing}`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-medium">{state === "available" ? "Release 3 is available" : state === "scheduled" ? "Release 3 is scheduled" : "Release 3 is ready to apply"}</p>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">Example release notes</span>
        </div>

        <p className="mt-3 text-xs uppercase tracking-[0.12em] text-graphite">What changes</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs uppercase tracking-[0.12em] text-graphite">What stays the same</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
          {unchanged.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-graphite">
          Published by Symbolon in the release registry. Your Vault takes only a release you schedule, and only its owner can apply it.
        </p>

        <div className="mt-4 border-t border-rule pt-4">
          {state === "available" && signing === null ? (
            <>
              <p className="text-sm text-graphite">Scheduling starts your 24-hour delay. Nothing changes until you apply it, and payments keep running on release 2.</p>
              <button onClick={() => setSigning("schedule")} className="mt-3 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
                Schedule release 3
              </button>
            </>
          ) : null}

          {state === "available" && signing === "schedule" ? (
            <>
              <p className="text-sm">One transaction, signed with your wallet: schedule this release for your Vault.</p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => {
                    setSigning(null);
                    schedule();
                  }}
                  className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper"
                >
                  Sign and schedule
                </button>
                <button onClick={() => setSigning(null)} className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
                  Not now
                </button>
              </div>
            </>
          ) : null}

          {state === "scheduled" ? (
            <>
              <p className="text-sm">
                Scheduled. You can apply it in <span className="font-mono tabular-nums">{remaining}</span>.{" "}
                <TxLink hash={tx.upgradeSchedule}>Scheduled in {tx.upgradeSchedule}</TxLink>
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-rule-soft" role="progressbar" aria-label="Delay elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
                <div className="h-full bg-seal" style={{ width: `${Math.max(1, fraction * 100)}%` }} />
              </div>
              <p className="mt-2 text-sm text-graphite">Payments keep running on release 2 until you apply it.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={cancel} className="rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash">
                  Cancel the schedule
                </button>
                <button onClick={skipWait} className="font-mono text-[11px] uppercase tracking-[0.12em] text-graphite underline decoration-rule underline-offset-4">
                  Prototype: skip the wait
                </button>
              </div>
            </>
          ) : null}

          {state === "ready" && signing === null ? (
            <>
              <p className="text-sm">
                The delay has passed. Apply release 3 when you’re ready. <TxLink hash={tx.upgradeSchedule}>Scheduled in {tx.upgradeSchedule}</TxLink>
              </p>
              <div className="mt-3 flex gap-3">
                <button onClick={() => setSigning("apply")} className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
                  Apply release 3
                </button>
                <button onClick={cancel} className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
                  Cancel the schedule
                </button>
              </div>
            </>
          ) : null}

          {state === "ready" && signing === "apply" ? (
            <>
              <p className="text-sm">One transaction, signed with your wallet: switch your Vault to release 3.</p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => {
                    setSigning(null);
                    apply();
                  }}
                  className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper"
                >
                  Sign and apply
                </button>
                <button onClick={() => setSigning(null)} className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
                  Not yet
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
