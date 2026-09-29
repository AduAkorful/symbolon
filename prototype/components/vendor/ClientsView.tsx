"use client";

import { useState } from "react";
import { Act } from "@/components/Act";
import { clients } from "@/lib/ana";

/** What a client's verification of you looks like from your side (spec §11.1): a code to read out, an amount to confirm, an invitation */
function Verification() {
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<"idle" | "wrong" | "ok">("idle");
  return (
    <section data-reveal aria-labelledby="verify" className="mt-8">
      <h2 id="verify" className="font-display text-3xl">
        Verification
      </h2>
      <p className="mt-1 max-w-[64ch] text-sm text-graphite">
        Clients confirm you’re who you say you are before they pay you. You only ever answer people you already know.
      </p>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-doc border border-rule bg-paper-raised p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Code for Halden Retail</p>
          <p className="mt-3 font-mono text-4xl tracking-[0.2em]">417 093</p>
          <p className="mt-3 text-sm">Read it out only to someone at Halden you already know, whom you called or who’s on a thread you already had. Expires in 30 minutes.</p>
          <p className="mt-2 text-xs text-red">Never read it to someone who called you and asked for it.</p>
        </div>
        <div className="rounded-doc border border-rule bg-paper-raised p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Test payment from Kite & Co</p>
          <p className="mt-2 text-sm">A small payment arrived at your address. Enter the exact amount you received.</p>
          {state === "ok" ? (
            <p role="status" className="mt-3 text-sm">
              Confirmed. Kite & Co now knows your address works. That doesn’t verify you; they’ll confirm who you are another way.
            </p>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setState(Number(amount.replace(/[^\d.]/g, "")) === 0.37 ? "ok" : "wrong");
              }}
            >
              <input
                required
                inputMode="decimal"
                aria-label="Amount received"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setState("idle");
                }}
                placeholder="$0.00"
                className="w-28 rounded-doc border border-rule bg-paper px-3 py-2 font-mono"
              />
              <button className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">Confirm</button>
              {state === "wrong" ? (
                <p role="alert" className="basis-full text-sm text-red">
                  That isn’t what arrived. Check your balance. If you can’t find it, don’t confirm.
                </p>
              ) : (
                <p className="basis-full text-xs text-graphite">Demo: $0.37 arrived.</p>
              )}
            </form>
          )}
        </div>
        <div className="rounded-doc border border-rule bg-paper-raised p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Invitation from Kite & Co</p>
          <p className="mt-2 text-sm">Kite & Co added you as a vendor and sent this to the address they already had for you. Accepting links your Seal to their record.</p>
          <div className="mt-4">
            <Act
              className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper"
              done="Accepted. Kite & Co has your Seal linked to their record, and you’re verified for them without a code."
            >
              Accept the invitation
            </Act>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Clients (V11): who's on Symbolon, the record with each, and inviting a client */
export function ClientsView() {
  const [sent, setSent] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Clients
      </h1>
      <Verification />
      <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ul data-reveal className="border-t border-ink">
          {clients.map((c) => (
            <li key={c.name} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[1fr_auto]">
              <span>
                <span className="font-medium">{c.name}</span> <span className={`ml-2 text-xs ${c.on ? "text-seal" : "text-graphite"}`}>{c.on ? "On Symbolon" : "Invited"}</span>
                <span className="block text-sm text-graphite">{c.note}</span>
              </span>
              <span className="text-sm sm:text-right">
                {c.invoices} invoices · {c.paid}
                <span className="block text-graphite">{c.avgDays === "—" ? "No payments yet" : `${c.avgDays} to paid, on average`}</span>
              </span>
            </li>
          ))}
        </ul>
        <section data-reveal aria-labelledby="invite" className="rounded-doc border border-rule bg-paper-raised p-6">
          <h2 id="invite" className="font-display text-3xl">
            Invite a client
          </h2>
          <p className="mt-2 text-sm text-graphite">The easiest invite is an invoice: they open it, pay it, and can set up their business as they do. Or send them a note.</p>
          {sent ? (
            <p role="status" className="mt-4 text-sm">
              Invite sent to {sent}. It says who you are and links to your profile; nothing else.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email) setSent(email);
              }}
              className="mt-4 space-y-3"
            >
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="finance@client.example" aria-label="Client email" className="w-full rounded-doc border border-rule bg-paper px-3 py-2.5" />
              <button className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">Send invite</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
