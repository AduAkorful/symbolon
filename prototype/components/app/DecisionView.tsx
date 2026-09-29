import Link from "next/link";
import { TxLink } from "@/components/TxLink";
import type { Decision } from "@/lib/acme";
import { tx } from "@/lib/tx";
import { Act } from "@/components/Act";

const outcomeTone: Record<Decision["outcome"], string> = {
  paid: "text-seal",
  moved: "text-seal",
  scheduled: "text-ink",
  recommended: "text-seal",
  held: "text-red",
  refused: "text-red",
};

/** A decision record (B17): what the Steward saw, what it weighed, the rule, and what happened. In reading order. */
export function DecisionView({ d }: { d: Decision }) {
  return (
    <main className="px-6 pb-24 pt-8 md:px-10">
      <p data-reveal className="text-sm text-graphite">
        <Link href="/b/steward" className="hover:text-ink">
          Steward
        </Link>
        <span className="mx-1.5">/</span> Decision {d.id}
      </p>
      <p data-reveal className={`mt-4 font-mono text-xs uppercase tracking-[0.16em] ${outcomeTone[d.outcome]}`}>
        {d.outcome} · {d.time}
      </p>
      <h1 data-reveal className="mt-3 max-w-[34ch] font-display text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[1.08]">
        {d.summary}
      </h1>

      <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-10">
          <section data-reveal aria-labelledby="trigger">
            <h2 id="trigger" className="text-xs uppercase tracking-[0.14em] text-graphite">
              What started it
            </h2>
            <p className="mt-2 text-lg">{d.trigger}</p>
          </section>

          <section aria-labelledby="inputs">
            <h2 id="inputs" data-reveal className="text-xs uppercase tracking-[0.14em] text-graphite">
              What it saw
            </h2>
            <dl className="mt-3 border-t border-ink">
              {d.inputs.map(([k, v]) => (
                <div key={k} data-reveal className="grid gap-1 border-b border-rule py-3 text-sm sm:grid-cols-[11rem_1fr]">
                  <dt className="text-graphite">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="options">
            <h2 id="options" data-reveal className="text-xs uppercase tracking-[0.14em] text-graphite">
              What it weighed
            </h2>
            <ol className="mt-3 border-t border-ink">
              {d.options.map((o) => (
                <li key={o.option} data-reveal className="grid grid-cols-[1.5rem_1fr] gap-3 border-b border-rule py-3">
                  <span aria-label={o.chosen ? "Chosen" : "Not chosen"} className={o.chosen ? "text-seal" : "text-graphite"}>
                    {o.chosen ? "✓" : "–"}
                  </span>
                  <span>
                    <span className={o.chosen ? "font-medium" : ""}>{o.option}</span>
                    <span className="block text-sm text-graphite">{o.why}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-8">
          <section data-reveal className="rounded-doc border border-rule bg-paper-raised p-5">
            <h2 className="text-xs uppercase tracking-[0.14em] text-graphite">The rule</h2>
            <p className="mt-2">{d.rule}</p>
            <p className="mt-3 text-sm text-graphite">Acme’s Vault checks this rule again before any money moves. The Steward can’t skip it.</p>
          </section>
          <section data-reveal>
            <h2 className="text-xs uppercase tracking-[0.14em] text-graphite">What happened</h2>
            <p className="mt-2">
              {d.tx ? (
                <>
                  Transaction <TxLink hash={d.tx}>{d.tx}</TxLink> on Arc.
                </>
              ) : d.outcome === "recommended" ? (
                <>
                  Waiting for an approver.{" "}
                  <Link href="/b/approvals" className="underline decoration-rule underline-offset-4">
                    Review and sign
                  </Link>
                </>
              ) : (
                "No money moved."
              )}
            </p>
            {d.human ? <p className="mt-2 text-sm text-graphite">You: {d.human}</p> : null}
          </section>
          <section data-reveal>
            <h2 className="text-xs uppercase tracking-[0.14em] text-graphite">Can this record change?</h2>
            <p className="mt-2 text-sm">
              {d.anchor.status === "anchored"
                ? `No. Its fingerprint is in batch ${d.anchor.batch}, anchored onchain; anyone with this record can check the proof.`
                : `Records are append-only. This one joins batch ${d.anchor.batch}, anchored onchain within the hour.`}
            </p>
            {d.anchor.status === "anchored" ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                <Act
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                  done={`Checked in your browser: this record’s fingerprint is in batch ${d.anchor.batch}, and the batch matches the root anchored onchain.`}
                >
                  Check the proof
                </Act>
                <TxLink hash={tx.anchor211}>Batch {d.anchor.batch} anchored in {tx.anchor211}</TxLink>
              </div>
            ) : null}
          </section>
          {d.invoiceId ? (
            <Link data-reveal href={`/b/inbox/${d.invoiceId}`} className="inline-block text-sm underline decoration-rule underline-offset-4">
              Open the invoice
            </Link>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
