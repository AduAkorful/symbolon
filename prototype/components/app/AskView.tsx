"use client";

import Link from "next/link";
import { useState } from "react";

const answers: Record<string, { text: string; links: [string, string][] }> = {
  "What are we paying this week?": {
    text: "$3,100.00 across three bills, all on 30 Sep: Cloudline $1,240.00 and two smaller ones. Northwind’s $8,892.00 goes today too if you approve its early-pay offer. Operating stays above the $20,000.00 buffer either way.",
    links: [["Northwind’s offer", "/b/approvals"], ["Cloudline CL-1024", "/b/inbox/cloudline-1024"]],
  },
  "Why did you hold Forge Supply’s invoice?": {
    text: "Hardware needs a confirmed delivery before it can be paid, and PO-0044 hasn’t been confirmed. I asked Dele at 09:40. Once it’s confirmed, it still needs your signature because it’s over $10,000.00.",
    links: [["The decision", "/b/decisions/d-0940"], ["Confirm delivery", "/b/orders"]],
  },
  "How much has Early Pay earned this quarter?": {
    text: "$142.50 across 4 discounts, all above your bar of reserve plus 3 points. I declined 2 that didn’t clear it. The reserve is new today, so it hasn’t earned anything to report yet.",
    links: [["Early Pay program", "/b/treasury"]],
  },
  "Is anything unusual?": {
    text: "Two things. An unsealed email claiming to be Studio Ana asked for payment to a new address; I refused it. And Northwind asked to change its payout address; it’s in its 72-hour cooldown and needs your confirmation.",
    links: [["The refusal", "/b/decisions/d-1005"], ["Northwind’s change", "/b/vendors"]],
  },
};

/** Ask the Steward (B18): questions about Acme's money, answered from its records, with links to the evidence */
export function AskView() {
  const [log, setLog] = useState<{ q: string; a?: (typeof answers)[string] }[]>([]);
  const [q, setQ] = useState("");
  const ask = (question: string) => {
    const a = answers[question] ?? {
      text: "I can answer questions about Acme’s invoices, payments, budgets, treasury and my own decisions. In this prototype, try one of the suggestions.",
      links: [],
    };
    setLog([...log, { q: question, a }]);
    setQ("");
  };
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-6 pb-10 pt-10 md:px-10">
      <h1 className="font-display text-5xl">Ask the Steward</h1>
      <p className="mt-2 text-graphite">Answers come from Acme’s records, with links to the evidence. Asking can’t move money.</p>
      <ol className="mt-8 flex-1 space-y-6" aria-live="polite">
        {log.map((m, i) => (
          <li key={i} className="space-y-3">
            <p className="ml-auto w-fit max-w-[80%] rounded-doc bg-ink px-4 py-2.5 text-paper">{m.q}</p>
            {m.a ? (
              <div className="max-w-[90%] border-l-2 border-seal pl-4">
                <p className="leading-relaxed">{m.a.text}</p>
                {m.a.links.length ? (
                  <p className="mt-2 flex flex-wrap gap-3 text-sm">
                    {m.a.links.map(([t, h]) => (
                      <Link key={h} href={h} className="underline decoration-rule underline-offset-4">
                        {t}
                      </Link>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {log.length === 0 || log.length < 4 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.keys(answers)
            .filter((k) => !log.some((m) => m.q === k))
            .map((k) => (
              <button key={k} onClick={() => ask(k)} className="rounded-full border border-rule px-3 py-1.5 text-sm hover:border-ink">
                {k}
              </button>
            ))}
        </div>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q.trim());
        }}
        className="mt-4 flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Your question" placeholder="Ask about invoices, payments, budgets…" className="w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none" />
        <button className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">Ask</button>
      </form>
    </main>
  );
}
