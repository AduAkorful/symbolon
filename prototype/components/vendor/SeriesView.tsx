"use client";

import Link from "next/link";
import { useState } from "react";

const periods = [
  { n: "0143", month: "October", release: "1 Oct", state: "Paid $1,985.00" },
  { n: "0145", month: "November", release: "1 Nov", state: "Sealed, releases 1 Nov" },
  { n: "0146", month: "December", release: "1 Dec", state: "Sealed, releases 1 Dec" },
  { n: "0147", month: "January", release: "1 Jan", state: "Sealed, releases 1 Jan" },
  { n: "0148", month: "February", release: "1 Feb", state: "Sealed, releases 1 Feb" },
  { n: "0149", month: "March", release: "1 Mar", state: "Sealed, releases 1 Mar" },
];

const milestones = [
  { name: "Type and colour system", amount: "$1,600.00", state: "Delivered 20 Sep · invoiced as 0144" },
  { name: "Launch templates", amount: "$800.00", state: "In progress · invoice when marked done" },
];

/** Series (V9) and milestones (V10): recurring invoices sealed once up front; milestones invoiced as they're done */
export function SeriesView() {
  const [stopped, setStopped] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Series
      </h1>
      <p data-reveal className="mt-2 max-w-[64ch] text-graphite">
        A retainer is approved and sealed once. Symbolon releases each month’s invoice on its date; it never holds your key or signs for you.
      </p>
      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <section data-reveal aria-labelledby="retainer">
          <h2 id="retainer" className="font-display text-3xl">
            Acme retainer
          </h2>
          <p className="mt-1 text-sm text-graphite">$2,000.00 a month · PO-0031 · 0.75% off within 15 days · sealed 3 Sep</p>
          <ol className="mt-4 border-t border-ink text-sm">
            {periods.map((p, i) => (
              <li key={p.n} className="grid grid-cols-[4rem_7rem_1fr] gap-3 border-b border-rule py-3">
                <span className="font-mono text-graphite">{p.n}</span>
                <span>{p.month}</span>
                <span className={i === 0 ? "text-seal" : stopped ? "text-red" : "text-graphite"}>{i > 0 && stopped ? "Cancelled" : p.state}</span>
              </li>
            ))}
          </ol>
          {stopped ? (
            <p role="status" className="mt-3 text-sm">
              The remaining five invoices are cancelled and can never be paid. Acme has been told.
            </p>
          ) : (
            <button onClick={() => setStopped(true)} className="mt-4 rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash">
              End the retainer after October
            </button>
          )}
        </section>
        <section data-reveal aria-labelledby="ms">
          <h2 id="ms" className="font-display text-3xl">
            Brand refresh milestones
          </h2>
          <p className="mt-1 text-sm text-graphite">For Acme, PO-0036, $2,400.00 in two parts</p>
          <ol className="mt-4 border-t border-ink text-sm">
            {milestones.map((m, i) => (
              <li key={m.name} className="grid grid-cols-[1fr_auto] gap-3 border-b border-rule py-3">
                <span>
                  {m.name}
                  <span className="block text-graphite">{i === 1 && done ? "Marked done · invoice 0150 drafted for you to seal" : m.state}</span>
                </span>
                <span>{m.amount}</span>
              </li>
            ))}
          </ol>
          {!done ? (
            <button onClick={() => setDone(true)} className="mt-4 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
              Mark launch templates done
            </button>
          ) : null}
          <Link href="/v/new" className="mt-8 block w-fit rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
            Start a new series
          </Link>
        </section>
      </div>
    </main>
  );
}
