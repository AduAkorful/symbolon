"use client";

import { useState, type ReactNode } from "react";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";

interface Rule {
  id: string;
  group: string;
  name: string;
  value: number;
  unit: "$" | "h" | "days" | "%" | "pts";
  /** Which direction loosens the rule: higher value, or lower */
  looserWhen: "higher" | "lower";
  note: string;
}

const initial: Rule[] = [
  { id: "autopay", group: "Paying without a person", name: "Auto-pay limit", value: 2500, unit: "$", looserWhen: "higher", note: "For verified vendors with 3 or more paid invoices" },
  { id: "owner", group: "Paying without a person", name: "Owner signs above", value: 10000, unit: "$", looserWhen: "higher", note: "Between the auto-pay limit and this, a budget’s approver signs" },
  { id: "pertx", group: "Paying without a person", name: "Largest single payment", value: 50000, unit: "$", looserWhen: "higher", note: "No payment above this, whoever signs" },
  { id: "cooldown", group: "Who gets paid", name: "Payout and Seal change cooldown", value: 72, unit: "h", looserWhen: "lower", note: "Plus a person’s confirmation" },
  { id: "newpayee", group: "Who gets paid", name: "New payee wait", value: 24, unit: "h", looserWhen: "lower", note: "The first invoice from a new Seal always needs a person too" },
  { id: "screening", group: "Who gets paid", name: "Screening no older than", value: 30, unit: "days", looserWhen: "higher", note: "Medium risk needs an approver; high risk the owner; sanctioned is blocked" },
  { id: "spread", group: "Early Pay", name: "Minimum return over reserve", value: 3, unit: "pts", looserWhen: "lower", note: "Annualized discount must beat reserve yield by this" },
  { id: "epcap", group: "Early Pay", name: "Cash committed to early payments", value: 30, unit: "%", looserWhen: "higher", note: "Of operating cash, at any time" },
  { id: "buffer", group: "Treasury", name: "Operating buffer", value: 20000, unit: "$", looserWhen: "lower", note: "Kept in operating; about 30 days of bills" },
  { id: "reserve", group: "Treasury", name: "Most in reserve", value: 60, unit: "%", looserWhen: "higher", note: "Of dollars held, in USYC" },
  { id: "delay", group: "Changing these rules", name: "Wait before a loosening change applies", value: 24, unit: "h", looserWhen: "lower", note: "Tightening changes apply at once" },
];

const show = (r: Pick<Rule, "unit">, v: number) =>
  r.unit === "$" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : r.unit === "pts" ? `${v} points` : `${v}${r.unit === "%" ? "%" : ` ${r.unit === "h" ? "hours" : "days"}`}`;

const history = [
  ["v7 · 24 Sep", "Auto-pay limit raised to $2,500.00 (queued 23 Sep, applied after 24 h)", "You"],
  ["v6 · 19 Sep", "Early Pay cap raised to 30% of operating", "You"],
  ["v5 · 14 Sep", "Steward switched from Shadow to Assisted", "You"],
  ["v4 · 12 Sep", "Studio Ana added as a payee", "You"],
];

/** Policy (B14): every rule the Vault enforces, what's queued, and what changed */
export function PolicyView() {
  const [rules, setRules] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [queued, setQueued] = useState<{ id: string; name: string; from: string; to: string; when: string; tx: string }[]>([
    { id: "halden", name: "Halden Freight paid without asking up to", from: "$2,500.00", to: "$5,000.00", when: "Applies in 23 h 12 m", tx: tx.policyQueue },
  ]);
  const [flash, setFlash] = useState<ReactNode>(null);

  const save = (r: Rule) => {
    const v = Number(draft.replace(/[^\d.]/g, ""));
    setEditing(null);
    if (!Number.isFinite(v) || v === r.value) return;
    const loosens = r.looserWhen === "higher" ? v > r.value : v < r.value;
    if (loosens) {
      setQueued([{ id: r.id, name: r.name, from: show(r, r.value), to: show(r, v), when: "Applies in 24 h 00 m", tx: tx.policyQueue }, ...queued.filter((q) => q.id !== r.id)]);
      setFlash(
        <>
          {r.name}: loosening, so it waits 24 hours. You can cancel it until then. <TxLink hash={tx.policyQueue}>Queued in {tx.policyQueue}</TxLink>
        </>,
      );
    } else {
      setRules(rules.map((x) => (x.id === r.id ? { ...x, value: v } : x)));
      setFlash(
        <>
          {r.name}: tightening, so it applies now. <TxLink hash={tx.policyApply}>Applied in {tx.policyApply}</TxLink>
        </>,
      );
    }
  };

  const groups = [...new Set(rules.map((r) => r.group))];
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Policy
      </h1>
      <p data-reveal className="mt-2 max-w-[70ch] text-graphite">
        The rules Acme’s Vault enforces for every payment, whoever or whatever asks. Making a rule stricter applies at once; making it looser
        waits, so a stolen session can’t widen a limit and pay out in the same minute.
      </p>
      {flash ? (
        <p role="status" className="mt-6 rounded-doc border border-seal/40 bg-seal-wash/50 px-4 py-3 text-sm">
          {flash}
        </p>
      ) : null}

      <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-10">
          {groups.map((g) => (
            <section key={g} data-reveal aria-labelledby={g}>
              <h2 id={g} className="font-display text-2xl">
                {g}
              </h2>
              <ul className="mt-3 border-t border-ink">
                {rules
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <li key={r.id} className="grid gap-2 border-b border-rule py-3.5 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <p className="font-medium">{r.name}</p>
                        <p className="text-sm text-graphite">{r.note}</p>
                      </div>
                      {editing === r.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            save(r);
                          }}
                          className="flex items-center gap-2"
                        >
                          <input aria-label={r.name} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="w-28 rounded-doc border border-ink bg-paper px-2 py-1.5 text-right tabular-nums" />
                          <button className="rounded-doc bg-ink px-3 py-1.5 text-sm text-paper">Save</button>
                          <button type="button" onClick={() => setEditing(null)} className="text-sm text-graphite">
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-4">
                          <span className="tabular-nums">{show(r, r.value)}</span>
                          <button
                            onClick={() => {
                              setEditing(r.id);
                              setDraft(String(r.value));
                            }}
                            className="text-sm underline decoration-rule underline-offset-4"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <section data-reveal aria-labelledby="budgets">
            <h2 id="budgets" className="font-display text-2xl">
              Budgets
            </h2>
            <p className="mt-1 text-sm text-graphite">Caps on spending from Acme’s one balance, not separate pots of money. Edit them in Treasury.</p>
          </section>
        </div>

        <aside className="space-y-10">
          <section data-reveal aria-labelledby="queued" className="rounded-doc border border-rule bg-paper-raised p-5">
            <h2 id="queued" className="font-display text-2xl">
              Waiting to apply
            </h2>
            {queued.length ? (
              <ul className="mt-3 space-y-4">
                {queued.map((q) => (
                  <li key={q.id} className="border-b border-rule-soft pb-4 last:border-0 last:pb-0">
                    <p className="font-medium">{q.name}</p>
                    <p className="text-sm">
                      {q.from} → {q.to}
                    </p>
                    <p className="mt-1 text-sm text-graphite">{q.when}</p>
                    <TxLink hash={q.tx} className="mt-1">
                      Queued in {q.tx}
                    </TxLink>
                    <button
                      onClick={() => {
                        setQueued(queued.filter((x) => x.id !== q.id));
                        setFlash(
                          <>
                            Cancelled: {q.name} stays at {q.from}. <TxLink hash={tx.policyCancel}>Cancelled in {tx.policyCancel}</TxLink>
                          </>,
                        );
                      }}
                      className="mt-2 block text-sm text-red underline decoration-red/40 underline-offset-4"
                    >
                      Cancel this change
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-graphite">Nothing is waiting. Loosening changes appear here during their wait.</p>
            )}
          </section>
          <section data-reveal aria-labelledby="history">
            <h2 id="history" className="font-display text-2xl">
              History
            </h2>
            <ol className="mt-3 border-t border-ink text-sm">
              {history.map(([v, what, who]) => (
                <li key={v} className="border-b border-rule py-3">
                  <p className="font-mono text-xs text-graphite">{v}</p>
                  <p>{what}</p>
                  <p className="text-xs text-graphite">Signed by {who}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}
