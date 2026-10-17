import Link from "next/link";

import { TxLink } from "@/components/TxLink";
import type { DecisionDetailView } from "@/lib/server/decisions";
import { AnchorProof } from "./AnchorProof";
import { formatDateTime, shortHex } from "@/lib/format";
import { describeInputs, formatOutcome } from "@/lib/decision-inputs";
import { CopyButton } from "@/components/CopyButton";
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
  // "scheduled for 2026-10-27T…" is the scheduled outcome; its time is said the way the rest of the app says it (QA retest 19)
  const tone = outcomeTone[d.outcome] ?? outcomeTone[d.outcome.split(" ")[0] ?? ""] ?? "neutral";
  const outcomeText = formatOutcome(d.outcome);
  const inputRows = describeInputs(d.inputs, d.currency);

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
          <StatusPill tone={tone}>{outcomeText}</StatusPill>
          <span className="text-sm text-graphite">{formatDateTime(new Date(d.at))}</span>
          {d.mode ? <StatusPill tone="neutral">{d.mode} mode</StatusPill> : null}
          <span className="sm:ml-auto">
            <StatusPill tone={d.hashMatches ? "ok" : "danger"}>{d.hashMatches ? "Hash verified" : "Hash doesn’t match"}</StatusPill>
          </span>
        </div>

        <PageTitle className="mt-4">{d.sentence}</PageTitle>

        {d.since ? (
          <p role="note" className="mt-3 text-sm text-graphite">
            This is what the Steward found on {formatDateTime(new Date(d.at))}, and it stays as written.{" "}
            {d.since.newerId ? (
              <>
                A later record for this invoice exists ({d.since.newerAt ? laterTime(new Date(d.at), new Date(d.since.newerAt)) : "newer"}){d.since.newerSentence ? `, “${d.since.newerSentence}”` : ""}:{" "}
                <Link href={`/business/decisions/${d.since.newerId}`} className="underline decoration-rule underline-offset-4 hover:text-ink">open it</Link>.{" "}
              </>
            ) : null}
            {d.since.invoiceStatus ? `The invoice is now ${d.since.invoiceStatus.replace(/_/g, " ")}. ` : ""}
            {d.since.invoiceHref ? (
              <Link href={d.since.invoiceHref} className="underline decoration-rule underline-offset-4 hover:text-ink">See what stands in the way now</Link>
            ) : null}
          </p>
        ) : null}

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
                Triggered by <span className="font-medium">{d.kindLabel}</span>
                {d.subjectLabel && !d.kindLabel.toLowerCase().includes(d.subjectLabel.toLowerCase()) ? (
                  <>
                    {" "}
                    for <span>{d.subjectLabel}</span>
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
            {/* labelled and in words; the stored values stay one click away for an audit (QA retest 19) */}
            <dl className="mt-3 divide-y divide-rule-soft rounded-doc border border-rule bg-paper-raised text-sm">
              {inputRows.map((row) => (
                <div key={row.key} className="grid gap-1 p-3.5 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-graphite font-medium">{row.label}</dt>
                  <dd className="text-ink break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
            {inputRows.length > 0 ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer select-none font-medium text-graphite hover:text-ink">Show raw</summary>
                <dl className="mt-2 divide-y divide-rule-soft rounded-doc border border-rule-soft bg-paper p-1">
                  {inputRows.map((row) => (
                    <div key={row.key} className="grid gap-1 p-2.5 sm:grid-cols-[11rem_1fr]">
                      <dt className="font-mono text-graphite">{row.key}</dt>
                      <dd className="whitespace-pre-wrap break-all font-mono text-ink">{row.raw}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
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
            <p className="text-sm text-ink">{outcomeText}</p>

            {d.txHash ? (
              <div className="border-t border-rule-soft pt-3">
                <span className="text-xs text-graphite">Transaction on Arc:</span>
                <p className="mt-1 flex items-baseline font-mono text-xs">
                  <TxLink
                    href={`${explorerUrl}/tx/${d.txHash}`}
                    label={`View transaction ${d.txHash} on Arc explorer`}
                    className="whitespace-nowrap underline text-graphite hover:text-ink"
                  >
                    <span title={d.txHash}>{shortHex(d.txHash)}</span>
                  </TxLink>
                  <CopyButton value={d.txHash} label={`Copy transaction hash ${d.txHash}`} />
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

/** The later record's time; with seconds when it falls in the same minute as this one, so the two never read the same (QA STW-4) */
function laterTime(at: Date, newer: Date): string {
  const text = formatDateTime(newer);
  if (Math.floor(at.getTime() / 60_000) !== Math.floor(newer.getTime() / 60_000)) return text;
  return text.replace(/ UTC$/, `:${String(newer.getUTCSeconds()).padStart(2, "0")} UTC`);
}
