import Link from "next/link";

import { TxLink } from "@/components/TxLink";
import type { DecisionDetailView } from "@/lib/server/decisions";
import { AnchorProof } from "./AnchorProof";
import { formatDateTime } from "@/lib/format";
import { StatusPill, type Tone } from "@/components/ui/StatusPill";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

const outcomeTone: Record<string, Tone> = {
  paid: "ok",
  paying: "ok",
  proposed: "neutral",
  scheduled: "neutral",
  awaiting_approval: "info",
  request_approval: "info",
  approval_granted: "ok",
  approval_rejected: "danger",
  held: "danger",
  refused: "danger",
  rejected: "danger",
  skip: "neutral",
  already_settled: "neutral",
};

interface Props {
  decision: DecisionDetailView;
  explorerUrl: string;
}

export function DecisionView({ decision: d, explorerUrl }: Props) {
  const tone = outcomeTone[d.outcome] ?? "neutral";

  return (
    <div className="space-y-10 pb-24">
      {/* Navigation & Status header */}
      <div>
        <Eyebrow>
          <Link href="/business/steward" className="hover:text-ink">
            Steward
          </Link>
          <span className="mx-2">/</span>
          <span>Decision record</span>
        </Eyebrow>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <StatusPill tone={tone}>{d.outcome.replace(/_/g, " ")}</StatusPill>
          <span className="text-sm text-graphite">{formatDateTime(new Date(d.at))}</span>
          {d.mode ? <StatusPill tone="neutral">{d.mode} mode</StatusPill> : null}
          <span className="sm:ml-auto">
            <StatusPill tone={d.hashMatches ? "ok" : "danger"}>{d.hashMatches ? "Hash verified" : "Hash doesn’t match"}</StatusPill>
          </span>
        </div>

        <PageTitle className="mt-4">{d.sentence}</PageTitle>

        {d.explanation ? (
          <p className="mt-3 border-l-2 border-seal/50 py-1 pl-4 text-base text-graphite">
            {d.explanation}
          </p>
        ) : null}
      </div>

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Left Column: Context, Inputs, What was weighed */}
        <div className="space-y-10">
          {/* Trigger */}
          <section aria-labelledby="trigger-title">
            <Eyebrow id="trigger-title" as="h2">
              What started it
            </Eyebrow>
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
            <Eyebrow id="inputs-title" as="h2">
              What it saw (inputs)
            </Eyebrow>
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
              <Eyebrow id="options-title" as="h2">
                What it weighed (options evaluated)
              </Eyebrow>
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
            <Eyebrow as="h2">
              The rule applied
            </Eyebrow>
            <p className="mt-2 text-sm text-ink font-medium">{d.rule || "Standard pipeline check"}</p>
            <p className="mt-3 text-sm text-graphite">
              Symbolon Vault contracts verify limits and invariants onchain before funds move. The Steward cannot circumvent onchain policy.
            </p>
          </section>

          {/* Outcome & Transaction */}
          <section className="rounded-doc border border-rule bg-paper-raised p-5 space-y-3">
            <Eyebrow as="h2">
              What happened
            </Eyebrow>
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
              <p className="text-sm text-graphite">No onchain transaction submitted for this decision.</p>
            )}
          </section>

          {/* Human Responses */}
          {d.humanResponses.length > 0 ? (
            <section className="rounded-doc border border-rule bg-paper-raised p-5 space-y-3">
              <Eyebrow as="h2">
                Human response
              </Eyebrow>
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
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-paper p-3 text-xs text-ink">
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
