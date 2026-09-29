"use client";

import Link from "next/link";
import { useState } from "react";
import { decisions } from "@/lib/acme";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { usePause } from "./pause";
import { Act } from "@/components/Act";

const modes = [
  { key: "shadow", name: "Shadow", body: "Decides, but never acts. You see what it would have done next to what your team did." },
  { key: "assist", name: "Assisted", body: "Pays only within auto-pay rules. Everything else comes to you as a one-tap approval." },
  { key: "auto", name: "Autonomous", body: "Runs everything your policy allows, and asks only at the thresholds you set." },
] as const;

const disagreements = [
  { when: "19 Sep", what: "Pay Cloudline early for 0.5% off", team: "Paid on the due date", why: "The team kept cash for payroll that week" },
  { when: "23 Sep", what: "Hold Halden Freight until delivery", team: "Paid on arrival", why: "Delivery was confirmed by phone, not in the system" },
  { when: "26 Sep", what: "Counter Northwind at 1.0%", team: "Accepted 1.2%", why: "The team valued the relationship over $18.00" },
];

/** The Steward (B16): mode, pause, its record in shadow mode, and what it suggests */
export function StewardView() {
  const { paused, setPaused, lastTx } = usePause();
  const [mode, setMode] = useState<(typeof modes)[number]["key"]>("assist");
  const [suggestion, setSuggestion] = useState<"open" | "queued" | "dismissed">("open");

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Steward
      </h1>
      <p data-reveal className="mt-2 max-w-[70ch] text-graphite">
        Acme’s agent for payables and treasury. It reads, matches, times and explains. Acme’s Vault enforces the limits in every
        mode: the Steward can’t withdraw, change policy, add a payee or change its own permissions.
      </p>

      <section data-reveal aria-labelledby="mode" className="mt-10">
        <h2 id="mode" className="font-display text-3xl">
          Mode
        </h2>
        <div role="radiogroup" aria-labelledby="mode" className="mt-5 grid gap-4 md:grid-cols-3">
          {modes.map((m) => (
            <button
              key={m.key}
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => setMode(m.key)}
              className={`rounded-doc border p-5 text-left transition-colors duration-[var(--dur-quick)] ${
                mode === m.key ? "border-ink bg-paper-raised" : "border-rule hover:border-ink/50"
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <span className={`grid h-4 w-4 place-items-center rounded-full border ${mode === m.key ? "border-ink" : "border-rule"}`}>
                  {mode === m.key ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
                </span>
                {m.name}
              </span>
              <span className="mt-2 block text-sm text-graphite">{m.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section data-reveal aria-labelledby="stop" className={`mt-10 rounded-doc border p-6 ${paused ? "border-red bg-red-wash" : "border-red/40"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="stop" className="font-display text-3xl text-red">
              {paused ? "Payments are paused" : "Pause payments"}
            </h2>
            <p className="mt-1 max-w-[60ch] text-sm">
              {paused
                ? "The Steward can’t pay and nothing scheduled goes out. Reading, matching and recording continue."
                : "One action stops the Steward and freezes every outgoing payment, instantly, in any mode."}
            </p>
            {lastTx ? (
              <p className="mt-2 text-sm">
                {lastTx.kind === "pause" ? "Paused in" : "Resumed in"} <TxLink hash={lastTx.hash}>transaction {lastTx.hash}</TxLink>
              </p>
            ) : null}
          </div>
          <button
            onClick={() => setPaused(!paused)}
            className={`rounded-doc px-5 py-3 font-medium ${paused ? "bg-red text-paper" : "border border-red text-red hover:bg-red-wash"}`}
          >
            {paused ? "Resume payments" : "Pause payments"}
          </button>
        </div>
      </section>

      <div className="mt-12 grid gap-12 xl:grid-cols-2">
        <section data-reveal aria-labelledby="record">
          <h2 id="record" className="font-display text-3xl">
            How it did in shadow mode
          </h2>
          <p className="mt-2 text-sm text-graphite">14–27 Sep, before you switched to Assisted</p>
          <p className="mt-5 font-display text-7xl leading-none">
            41 <span className="text-3xl text-graphite">of 44</span>
          </p>
          <p className="mt-2">decisions matched what your team did.</p>
          <ol className="mt-6 border-t border-ink text-sm">
            {disagreements.map((d) => (
              <li key={d.when} className="grid grid-cols-[4rem_1fr] gap-3 border-b border-rule py-3">
                <span className="font-mono text-xs text-graphite">{d.when}</span>
                <span>
                  Steward: {d.what}. Team: {d.team}.<span className="block text-graphite">{d.why}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section data-reveal aria-labelledby="suggests">
          <h2 id="suggests" className="font-display text-3xl">
            Suggests
          </h2>
          {suggestion === "open" ? (
            <div className="mt-5 rounded-doc border border-seal/40 bg-paper-raised p-5">
              <p className="text-lg leading-snug">
                You’ve approved all 5 of Halden Freight’s invoices, each under $5,000.00. Let the Steward pay Halden up to $5,000.00
                without asking?
              </p>
              <p className="mt-2 text-sm text-graphite">Raising a limit loosens the policy, so it waits 24 hours before it applies.</p>
              <div className="mt-4 flex gap-3">
                <button onClick={() => setSuggestion("queued")} className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
                  Queue the change
                </button>
                <button onClick={() => setSuggestion("dismissed")} className="rounded-doc border border-rule px-4 py-2.5 text-sm">
                  Not now
                </button>
              </div>
            </div>
          ) : suggestion === "queued" ? (
            <div role="status" className="mt-5 rounded-doc border border-rule p-5">
              <p className="font-medium">Queued: Halden Freight up to $5,000.00 without asking</p>
              <p className="mt-1 text-sm text-graphite">Applies in 23 h 59 m. You can cancel it until then, from Policy.</p>
              <div className="mt-3 h-1.5 w-full bg-rule-soft">
                <div className="h-full w-[1%] bg-ink" />
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-graphite">Dismissed. It won’t suggest this again for 30 days.</p>
          )}

          <h3 className="mt-10 text-sm font-medium">Its key</h3>
          <p className="mt-2 font-mono text-sm">0x51c9…e20b</p>
          <p className="mt-1 text-sm text-graphite">Can pay within policy. Can’t withdraw, change policy, add or change payees, or approve.</p>
          <div className="mt-3">
            <Act
              className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
              tx={tx.stewardKey}
              confirm={{
                title: "Replace the Steward’s key",
                body: "A new key is created for the Steward’s wallet and you sign one transaction to switch to it. Like any change that widens what the Steward can do, it waits your 24-hour delay. The old key keeps working until then, and you can cancel.",
                action: "Sign and queue",
              }}
              done="Queued: the new key takes over in 24 h 00 m."
            >
              Replace the key
            </Act>
          </div>

          <h3 className="mt-10 text-sm font-medium">Recent decisions</h3>
          <ul className="mt-2 border-t border-rule text-sm">
            {decisions.slice(0, 5).map((d) => (
              <li key={d.id} className="border-b border-rule">
                <Link href={`/b/decisions/${d.id}`} className="flex gap-3 py-2.5 hover:text-seal">
                  <span className="w-20 shrink-0 font-mono text-xs text-graphite">{d.time.replace("Today ", "")}</span>
                  <span className="line-clamp-1">{d.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
