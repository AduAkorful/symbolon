import Link from "next/link";

import { TxLink } from "@/components/TxLink";
import type { DecisionDetailView } from "@/lib/server/decisions";
import { AnchorProof } from "./AnchorProof";
import { formatDateTime } from "@/lib/format";

const outcomeTone: Record<string, string> = {
  paid: "text-seal bg-seal/10 border-seal/20",
  paying: "text-seal bg-seal/10 border-seal/20",
  proposed: "text-ink bg-ink/10 border-rule",
  scheduled: "text-ink bg-ink/10 border-rule",
  awaiting_approval: "text-seal bg-seal/10 border-seal/20",
  request_approval: "text-seal bg-seal/10 border-seal/20",
  approval_granted: "text-seal bg-seal/10 border-seal/20",
  approval_rejected: "text-red bg-red/10 border-red/20",
  held: "text-red bg-red/10 border-red/20",
  refused: "text-red bg-red/10 border-red/20",
  rejected: "text-red bg-red/10 border-red/20",
  skip: "text-graphite bg-paper border-rule-soft",
  already_settled: "text-graphite bg-paper border-rule-soft",
};

interface Props {
  decision: DecisionDetailView;
  explorerUrl: string;
}

export function DecisionView({ decision: d, explorerUrl }: Props) {
  const toneClass = outcomeTone[d.outcome] ?? "text-ink bg-paper border-rule";

  return (
    <div className="max-w-[1080px] space-y-10 pb-24">
      {/* Navigation & Status header */}
      <div>
        <p className="text-xs uppercase tracking-wider text-graphite">
          <Link href="/business/steward" className="hover:text-ink">
            Steward
          </Link>
          <span className="mx-2">/</span>
          <span>Decision record</span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-wider ${toneClass}`}>
            {d.outcome}
          </span>
          <span className="text-xs text-graphite">
            {formatDateTime(new Date(d.at))}
          </span>
          {d.mode ? (
            <span className="rounded bg-paper px-2 py-0.5 font-mono text-xs uppercase text-graphite border border-rule-soft">
              {d.mode} mode
            </span>
          ) : null}

          {d.hashMatches ? (
            <span className="ml-auto rounded bg-seal/10 px-2 py-0.5 font-mono text-xs text-seal">
              Hash verified ✓
            </span>
          ) : (
            <span className="ml-auto rounded bg-red/10 px-2 py-0.5 font-mono text-xs text-red">
              Hash mismatch ✕
            </span>
          )}
        </div>

        <h1 className="mt-4 font-display text-[clamp(1.9rem,3.2vw,2.8rem)] leading-[1.12] text-ink">
          {d.sentence}
        </h1>

        {d.explanation ? (
          <p className="mt-3 text-base text-graphite border-l-2 border-seal/50 pl-4 py-1 italic">
            "{d.explanation}"
          </p>
        ) : null}
      </div>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Left Column: Context, Inputs, What was weighed */}
        <div className="space-y-10">
          {/* Trigger */}
          <section aria-labelledby="trigger-title">
            <h2 id="trigger-title" className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
              What started it
            </h2>
            <div className="mt-3 rounded-doc border border-rule-soft bg-paper-raised p-4 text-sm">
              <p className="text-ink">
                Triggered by <span className="font-mono text-xs uppercase font-medium">{d.kind}</span>
                {d.subject ? (
                  <>
                    {" "}
                    for subject{" "}
                    <span className="font-mono text-xs break-all">{d.subject}</span>
                  </>
                ) : null}
              </p>
            </div>
          </section>

          {/* Inputs */}
          <section aria-labelledby="inputs-title">
            <h2 id="inputs-title" className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
              What it saw (inputs)
            </h2>
            <dl className="mt-3 divide-y divide-rule-soft rounded-doc border border-rule bg-paper-raised text-sm">
              {Object.entries(d.inputs).map(([k, v]) => (
                <div key={k} className="grid gap-1 p-3.5 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-graphite font-medium">{k}</dt>
                  <dd className="font-mono text-xs text-ink break-all">
                    {typeof v === "object" && v !== null ? JSON.stringify(v, null, 1) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Options Considered */}
          {d.options.length > 0 ? (
            <section aria-labelledby="options-title">
              <h2 id="options-title" className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
                What it weighed (options evaluated)
              </h2>
              <div className="mt-3 space-y-2">
                {d.options.map((opt, idx) => (
                  <div
                    key={idx}
                    className={`rounded-doc border p-4 text-sm ${
                      opt.clears
                        ? "border-seal/40 bg-seal/5"
                        : "border-rule-soft bg-paper-raised"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        Option #{idx + 1}: {opt.kind ?? "Payment timing"}
                      </span>
                      <span
                        className={`font-mono text-xs ${
                          opt.clears ? "text-seal font-medium" : "text-graphite"
                        }`}
                      >
                        {opt.clears ? "Passed criteria ✓" : "Did not clear –"}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono text-graphite sm:grid-cols-3">
                      {opt.discountBps !== undefined ? (
                        <div>Discount: {(opt.discountBps / 100).toFixed(2)}%</div>
                      ) : null}
                      {opt.annualizedBps !== undefined ? (
                        <div>Annualized: {(opt.annualizedBps / 100).toFixed(2)}%</div>
                      ) : null}
                                          </div>

                    {opt.reasons && opt.reasons.length > 0 ? (
                      <p className="mt-2 text-xs text-graphite">
                        Evaluation: {opt.reasons.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Right Column: Rule, What happened, Anchoring, Raw record */}
        <aside className="space-y-8">
          {/* Rule */}
          <section className="rounded-doc border border-rule bg-paper-raised p-5">
            <h2 className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
              The rule applied
            </h2>
            <p className="mt-2 text-sm text-ink font-medium">{d.rule || "Standard pipeline check"}</p>
            <p className="mt-3 text-xs text-graphite">
              Symbolon Vault contracts verify limits and invariants onchain before funds move. The Steward cannot circumvent onchain policy.
            </p>
          </section>

          {/* Outcome & Transaction */}
          <section className="rounded-doc border border-rule bg-paper-raised p-5 space-y-3">
            <h2 className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
              What happened
            </h2>
            <p className="text-sm text-ink">{d.outcome}</p>

            {d.txHash ? (
              <div className="border-t border-rule-soft pt-3">
                <span className="text-xs text-graphite">Transaction on Arc:</span>
                <p className="mt-1 font-mono text-xs break-all">
                  <TxLink
                    href={`${explorerUrl}/tx/${d.txHash}`}
                    label="View transaction on Arc explorer"
                    className="underline text-graphite hover:text-ink"
                  >
                    {d.txHash}
                  </TxLink>
                </p>
              </div>
            ) : (
              <p className="text-xs text-graphite">No onchain transaction submitted for this decision.</p>
            )}
          </section>

          {/* Human Responses */}
          {d.humanResponses.length > 0 ? (
            <section className="rounded-doc border border-rule bg-paper-raised p-5 space-y-3">
              <h2 className="text-xs uppercase tracking-[0.14em] text-graphite font-medium">
                Human response
              </h2>
              {d.humanResponses.map((hr) => (
                <div key={hr.id} className="text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono uppercase tracking-wider font-medium ${
                        hr.kind === "approval_granted" ? "text-seal" : "text-red"
                      }`}
                    >
                      {hr.kind === "approval_granted" ? "Approval granted" : "Approval rejected"}
                    </span>
                    <span className="text-graphite">
                      {formatDateTime(new Date(hr.createdAt))}
                    </span>
                  </div>
                  {hr.reason ? <p className="text-ink">Reason: {hr.reason}</p> : null}
                  {hr.actor ? <p className="font-mono text-graphite">Actor: {hr.actor}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          {/* Anchoring Section */}
          <section>
            <AnchorProof anchor={d.anchor} explorerUrl={explorerUrl} />
          </section>

          {/* Raw Canonical Record */}
          <section className="rounded-doc border border-rule-soft bg-paper-raised p-5 text-xs space-y-2">
            <details>
              <summary className="cursor-pointer font-medium text-graphite hover:text-ink select-none">
                Show canonical record & hash
              </summary>
              <div className="mt-3 space-y-3 font-mono">
                <div>
                  <span className="text-graphite">Record keccak256 hash:</span>
                  <p className="break-all text-ink mt-0.5">{d.hash}</p>
                </div>
                <div>
                  <span className="text-graphite">Canonical JSON:</span>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-paper p-3 text-[11px] text-ink">
                    {d.canonicalJson}
                  </pre>
                </div>
              </div>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}
