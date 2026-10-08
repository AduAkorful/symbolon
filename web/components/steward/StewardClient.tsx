"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";
import { Money } from "@/components/ui/Money";
import { EmptyState } from "@/components/ui/States";
import { StatusPill, type Tone } from "@/components/ui/StatusPill";
import { Eyebrow, Lead, PageTitle, SectionTitle } from "@/components/ui/Type";

const modes = [
  {
    key: "shadow",
    name: "Shadow",
    tagline: "Records only, sends nothing",
    body: "Decides and records, but never sends. You see what it would have done next to what happened.",
  },
  {
    key: "assist",
    name: "Assisted",
    tagline: "One-tap approval for every payment",
    body: "Proposes payments and marks them for human approval. Sends nothing on its own.",
  },
  {
    key: "auto",
    name: "Autonomous",
    tagline: "Executes within onchain limits",
    body: "Sends payments allowed by policy and node simulation. Holds or asks only when required.",
  },
] as const;

const STANDING: Record<string, string> = { active: "Active", paused: "Paused", mismatch: "Doesn't match", unknown: "Can't confirm", none: "No Steward set" };
const standingLabel = (kind: string) => STANDING[kind] ?? "Can't confirm";

const RUN: Record<string, { label: string; tone: Tone }> = {
  done: { label: "Completed", tone: "ok" },
  running: { label: "Running", tone: "info" },
  stalled: { label: "Stalled", tone: "warn" },
  failed: { label: "Failed", tone: "danger" },
  skipped_paused: { label: "Skipped: payments paused", tone: "neutral" },
  skipped_fees: { label: "Skipped: low fee balance", tone: "warn" },
};
const runLabel = (status: string) => RUN[status]?.label ?? status.replace(/_/g, " ");
const runTone = (status: string): Tone => RUN[status]?.tone ?? "neutral";

/** A counter's key as people would say it: "evaluatedInvoices" → "Evaluated invoices" */
const humanKey = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words[0]!.toUpperCase() + words.slice(1);
};

export interface DecisionView {
  id: string;
  kind: string;
  subject: string | null;
  txHash: string | null;
  createdAt: string;
  summary: {
    sentence: string;
    explanation?: string;
  };
}

export interface RunView {
  id: string;
  trigger: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Record<string, unknown>;
  error: string | null;
}

export interface ShadowView {
  compared: number;
  agreed: number;
  rateBps?: number;
  disagreements: { fingerprint: string; steward: string; actual: string }[];
}

export interface StewardClientProps {
  business: {
    id: string;
    name: string;
    vault: string;
    stewardWallet: string | null;
    mode: string;
    role: string;
  };
  standing: {
    kind: string;
    ready: boolean;
    block: string | null;
    reason: string | null;
  };
  fee: {
    formatted: string;
    raw: string | null;
  };
  policyLines: string[];
  lastRun: RunView | null;
  recentDecisions: DecisionView[];
  shadow: ShadowView;
  pendingAnchorCount?: number;
  signer: SignerPlan | null;
  explorer: string;
}

export function StewardClient({
  business,
  standing,
  fee,
  policyLines,
  lastRun,
  recentDecisions,
  shadow,
  pendingAnchorCount = 0,
  signer,
  explorer,
}: StewardClientProps) {
  const router = useRouter();
  const discover = useWalletProviders();

  const isOwner = business.role === "owner";
  const isApprover = business.role === "approver";
  const canRun = isOwner || isApprover;

  const [currentMode, setCurrentMode] = useState(business.mode);
  const [modePending, setModePending] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [policyConfirmed, setPolicyConfirmed] = useState(false);

  // Manual run state
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Anchoring state (A10)
  const [anchoring, setAnchoring] = useState(false);
  const [anchorMessage, setAnchorMessage] = useState<string | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  async function handleAnchorNow() {
    if (!canRun) return;
    setAnchoring(true);
    setAnchorMessage(null);
    setAnchorError(null);
    try {
      const res = await postJson<{ ok: boolean; txHash?: string; count?: number; error?: string }>(
        `/api/business/${business.id}/steward`,
        { action: "anchor" }
      );
      if (!res.ok) {
        throw new Error(res.error ?? "Anchoring failed.");
      }
      setAnchorMessage(`Anchored ${res.count ?? "batch"} decisions onchain.`);
      router.refresh();
    } catch (err) {
      setAnchorError(err instanceof Error ? err.message : "Anchoring failed.");
    } finally {
      setAnchoring(false);
    }
  }

  // Fee top-up state
  const [fundingOpen, setFundingOpen] = useState(false);
  const [feeAmount, setFeeAmount] = useState("0.1");
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);

  async function handleModeSelect(nextMode: "shadow" | "assist" | "auto") {
    if (!isOwner || nextMode === currentMode) return;
    setModeError(null);

    if (nextMode === "auto") {
      setAutoModalOpen(true);
      return;
    }

    setModePending(true);
    try {
      await postJson(`/api/business/${business.id}/steward`, {
        action: "mode",
        mode: nextMode,
      });
      setCurrentMode(nextMode);
      router.refresh();
    } catch (err) {
      setModeError(err instanceof Error ? err.message : "Could not update mode.");
    } finally {
      setModePending(false);
    }
  }

  async function confirmAutoMode() {
    if (!isOwner) return;
    setModePending(true);
    setModeError(null);
    try {
      await postJson(`/api/business/${business.id}/steward`, {
        action: "mode",
        mode: "auto",
        policyConfirmed: true,
      });
      setCurrentMode("auto");
      setAutoModalOpen(false);
      router.refresh();
    } catch (err) {
      setModeError(err instanceof Error ? err.message : "Could not enable Autonomous mode.");
    } finally {
      setModePending(false);
    }
  }

  async function handleRunNow() {
    if (!canRun) return;
    setRunning(true);
    setRunMessage(null);
    setRunError(null);
    try {
      const res = await postJson<{ ok: boolean; run: RunView }>(`/api/business/${business.id}/steward`, {
        action: "run",
      });
      setRunMessage(
        res.run.status === "done"
          ? "Run completed successfully."
          : res.run.status === "skipped_paused"
          ? "Run skipped: Payments are paused."
          : res.run.status === "skipped_fees"
          ? "Run skipped: Low Steward wallet fee balance."
          : `Run ended with status: ${res.run.status}`,
      );
      router.refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }

  async function handleFundFees() {
    if (!signer || !isOwner) return;
    setFundingBusy(true);
    setFundingError(null);
    try {
      const prep = await postJson<{ to: string; data: string; value: string }>(`/api/business/${business.id}/steward`, {
        action: "prepare-fee",
        amount: feeAmount,
      });
      const txHash = await sendCall(signer, prep, discover);
      await postJson(`/api/business/${business.id}/steward`, {
        action: "record-fee",
        txHash,
      });
      setFundingOpen(false);
      router.refresh();
    } catch (err) {
      setFundingError(wasRejected(err) ? "Request rejected in wallet." : err instanceof Error ? err.message : "Failed to fund fees.");
    } finally {
      setFundingBusy(false);
    }
  }

  const lowFees = fee.raw !== null && BigInt(fee.raw) < 10_000_000_000_000_000n;
  const standingTone: Tone = standing.kind === "active" ? "ok" : standing.kind === "paused" ? "danger" : "warn";

  return (
    <div className="space-y-14">
      <header>
        <PageTitle>Steward</PageTitle>
        <Lead className="mt-3">
          {business.name}’s agent for payables and cash. In every mode the Vault enforces its limits onchain: the Steward cannot
          withdraw money, change the policy or add payees.
        </Lead>
      </header>

      {/* Identity and standing */}
      <section aria-label="Steward status">
        <dl className="divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
          <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Wallet</dt>
            <dd className="min-w-0">
              {business.stewardWallet ? (
                <Address value={business.stewardWallet} full explorer={explorer} copy />
              ) : (
                <span className="text-warn">Not provisioned</span>
              )}
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Standing on Arc</dt>
            <dd>
              <StatusPill tone={standingTone}>{standingLabel(standing.kind)}</StatusPill>
              {standing.block ? <span className="ml-3 text-graphite">checked with Arc just now</span> : null}
              {standing.reason ? <p className="mt-2 text-warn">{standing.reason}</p> : null}
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Fee balance</dt>
            <dd className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span>
                <Money className="font-medium text-ink">{fee.formatted}</Money>
                {lowFees ? <span className="ml-3 text-warn">Low: 0.01 USDC is the least that keeps it running</span> : null}
              </span>
              {isOwner ? (
                <Button variant="secondary" size="sm" onClick={() => setFundingOpen(true)}>
                  Fund fees
                </Button>
              ) : null}
            </dd>
          </div>
        </dl>
      </section>

      {/* Mode */}
      <section aria-labelledby="mode-heading" className="space-y-4">
        <div>
          <SectionTitle id="mode-heading">Operating mode</SectionTitle>
          <p className="mt-1 text-sm text-graphite">This setting lives in Symbolon. The Vault’s own limits apply in every mode.</p>
        </div>

        {modeError ? <InlineError>{modeError}</InlineError> : null}

        <div role="radiogroup" aria-labelledby="mode-heading" className="grid gap-4 md:grid-cols-3">
          {modes.map((m) => {
            const active = currentMode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!isOwner || modePending}
                onClick={() => void handleModeSelect(m.key)}
                className={`rounded-doc border p-5 text-left transition-colors disabled:cursor-not-allowed ${
                  active ? "border-ink bg-paper-raised ring-1 ring-ink" : "border-rule hover:border-ink/50"
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-base font-medium text-ink">{m.name}</span>
                  <span className={`grid h-5 w-5 place-items-center rounded-full border ${active ? "border-ink" : "border-rule"}`}>
                    {active ? <span className="h-2.5 w-2.5 rounded-full bg-ink" /> : null}
                  </span>
                </span>
                <span className="mt-1 block text-sm font-medium text-graphite">{m.tagline}</span>
                <span className="mt-2 block text-sm text-graphite">{m.body}</span>
              </button>
            );
          })}
        </div>
        {!isOwner ? <p className="text-sm text-graphite">Only the business owner can change the Steward’s mode.</p> : null}
      </section>

      {/* Runs */}
      <section aria-labelledby="runs-heading" className="space-y-4 border-t border-rule pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionTitle id="runs-heading">Runs</SectionTitle>
            <p className="mt-1 text-sm text-graphite">The Steward runs when you ask. No schedule is set.</p>
          </div>
          {canRun ? (
            <Button busy={running} onClick={() => void handleRunNow()}>
              {running ? "Evaluating invoices…" : "Run now"}
            </Button>
          ) : null}
        </div>

        {runMessage ? <p role="status" className="text-sm text-ok">{runMessage}</p> : null}
        {runError ? <InlineError>{runError}</InlineError> : null}

        {lastRun ? (
          <div className="rounded-doc border border-rule px-5 py-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <span className="flex flex-wrap items-center gap-3">
                <StatusPill tone={runTone(lastRun.status)}>{runLabel(lastRun.status)}</StatusPill>
                <span className="text-graphite">Started by {lastRun.trigger}, in {lastRun.mode} mode</span>
              </span>
              <span className="text-graphite">{formatDateTime(new Date(lastRun.startedAt))}</span>
            </div>

            {lastRun.status === "stalled" ? (
              <p className="mt-3 text-warn">This run began more than five minutes ago and never reported back. Running again replaces it.</p>
            ) : null}
            {lastRun.error ? <p className="mt-3 text-red">Reason: {lastRun.error}</p> : null}

            {lastRun.summary && typeof lastRun.summary === "object" ? (
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
                {Object.entries(lastRun.summary).flatMap(([k, v]) =>
                  typeof v === "object" && v !== null
                    ? Object.entries(v as Record<string, number>).map(([sk, sv]) => [sk, sv] as const)
                    : [[k, v] as const],
                ).map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <dt className="text-graphite">{humanKey(k)}</dt>
                    <dd className="font-medium text-ink">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No runs yet">Press “Run now” and the Steward will look at every invoice waiting for it.</EmptyState>
        )}
      </section>

      {/* Agreement with the Steward's recommendations */}
      <section aria-labelledby="shadow-heading" className="space-y-4 border-t border-rule pt-8">
        <div>
          <SectionTitle id="shadow-heading">Your responses</SectionTitle>
          <p className="mt-1 text-sm text-graphite">Counts your latest response to each recommendation that asked for approval.</p>
        </div>

        {shadow.compared > 0 ? (
          <div className="rounded-doc border border-rule px-5 py-5">
            <p className="font-display text-4xl text-ink">
              {shadow.agreed} <span className="text-xl text-graphite">of {shadow.compared}</span>
            </p>
            <p className="mt-1 text-sm text-graphite">recommendations you agreed with.</p>

            {shadow.disagreements.length > 0 ? (
              <div className="mt-4 border-t border-rule-soft pt-3">
                <Eyebrow as="p">Where you disagreed</Eyebrow>
                <ul className="mt-2 divide-y divide-rule-soft text-sm">
                  {shadow.disagreements.map((d) => (
                    <li key={d.fingerprint} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-graphite">Invoice {d.fingerprint.slice(0, 10)}…</span>
                      <span>
                        Steward proposed <strong className="capitalize">{d.steward}</strong>, team recorded{" "}
                        <strong className="capitalize">{d.actual}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="Nothing to compare yet">Once you respond to a recommendation, your agreement with the Steward is counted here.</EmptyState>
        )}
      </section>

      {/* Anchoring */}
      <section aria-labelledby="anchoring-heading" className="space-y-4 border-t border-rule pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionTitle id="anchoring-heading">Anchoring</SectionTitle>
            <p className="mt-1 text-sm text-graphite">Decision records are batched into a Merkle tree and anchored in the Vault on Arc.</p>
          </div>
          {canRun ? (
            <Button variant="secondary" busy={anchoring} disabled={(pendingAnchorCount ?? 0) === 0} onClick={() => void handleAnchorNow()}>
              {anchoring ? "Anchoring…" : `Anchor now (${pendingAnchorCount ?? 0} waiting)`}
            </Button>
          ) : null}
        </div>

        {anchorMessage ? <p role="status" className="text-sm text-ok">{anchorMessage}</p> : null}
        {anchorError ? <InlineError>{anchorError}</InlineError> : null}

        <p className="text-sm text-graphite">
          {(pendingAnchorCount ?? 0) === 0
            ? "Every decision for this business is anchored onchain."
            : `${pendingAnchorCount} decision${pendingAnchorCount === 1 ? "" : "s"} waiting to be anchored in the Vault.`}
        </p>
      </section>

      {/* Recent decisions */}
      <section aria-labelledby="decisions-heading" className="space-y-4 border-t border-rule pt-8">
        <div>
          <SectionTitle id="decisions-heading">Recent decisions</SectionTitle>
          <p className="mt-1 text-sm text-graphite">Every decision is recorded with its inputs and the rule applied.</p>
        </div>

        {recentDecisions.length > 0 ? (
          <ul className="divide-y divide-rule-soft rounded-doc border border-rule text-sm">
            {recentDecisions.map((d) => (
              <li key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <Link href={`/business/decisions/${d.id}`} className="min-w-0 font-medium text-ink underline decoration-rule underline-offset-4 hover:text-seal">
                    {d.summary.sentence}
                  </Link>
                  <span className="shrink-0 text-graphite">{formatDateTime(new Date(d.createdAt))}</span>
                </div>
                {d.summary.explanation ? <p className="mt-1 text-graphite">{d.summary.explanation}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-graphite">
                  <span>{humanKey(d.kind)}</span>
                  {d.subject ? (
                    <Link href={`/business/inbox/${d.subject}`} className="underline decoration-rule underline-offset-4 hover:text-ink">
                      Invoice {d.subject.slice(0, 8)}…
                    </Link>
                  ) : null}
                  {d.txHash ? (
                    <TxLink href={`${explorer}/tx/${d.txHash}`} label="View transaction on explorer">
                      Transaction {d.txHash.slice(0, 8)}…
                    </TxLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No decisions yet">The Steward records a decision each time it looks at an invoice.</EmptyState>
        )}
      </section>

      {/* What the Steward can't do (spec 8.2) */}
      <section aria-labelledby="invariants-heading" className="rounded-doc border border-rule px-6 py-5 text-sm">
        <SectionTitle id="invariants-heading" className="!text-xl">What the Steward can’t do</SectionTitle>
        <p className="mt-1 text-graphite">The Vault contract enforces this onchain, in every mode:</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-graphite">
          <li>Withdraw funds or pay an address that isn’t an approved payee</li>
          <li>Change policy limits, cooldown periods or approval thresholds</li>
          <li>Add payees, change payout destinations or register Seals</li>
          <li>Approve a payment above the owner threshold without a person’s signature</li>
          <li>Pay an unsigned document or pay the same invoice twice</li>
        </ul>
      </section>

      {/* Autonomous mode confirmation */}
      {autoModalOpen ? (
        <Overlay
          title="Turn on Autonomous mode"
          description="The Steward will send payments to Arc by itself, within the limits the Vault enforces."
          onClose={() => setAutoModalOpen(false)}
        >
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 font-medium text-ink">The Vault's limits that always apply</p>
              <ul className="space-y-1.5 rounded-doc border border-rule px-4 py-3 text-graphite">
                {policyLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>

            <label className="flex min-h-11 cursor-pointer select-none items-start gap-3 rounded-doc border border-rule px-4 py-3">
              <input
                type="checkbox"
                checked={policyConfirmed}
                onChange={(e) => setPolicyConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--seal)]"
              />
              <span className="text-ink">I understand the Steward will make payments on its own within the rules above.</span>
            </label>

            {modeError ? <InlineError>{modeError}</InlineError> : null}

            <Overlay.Footer>
              <Button variant="secondary" onClick={() => setAutoModalOpen(false)}>Cancel</Button>
              <Button disabled={!policyConfirmed} busy={modePending} onClick={() => void confirmAutoMode()}>
                {modePending ? "Turning on…" : "Turn on Autonomous mode"}
              </Button>
            </Overlay.Footer>
          </div>
        </Overlay>
      ) : null}

      {/* Fee funding */}
      {fundingOpen ? (
        <Overlay
          title="Fund the Steward's network fees"
          description="Arc fees are paid in USDC. Send a small amount from your wallet so the Steward can send its transactions."
          onClose={() => setFundingOpen(false)}
        >
          <div className="space-y-4">
            <Field label="Amount (USDC)" hint="0.1 USDC is enough for hundreds of transactions.">
              {(a) => (
                <input {...a} type="text" inputMode="decimal" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} className={controlClass} placeholder="0.1" />
              )}
            </Field>

            {fundingError ? <InlineError>{fundingError}</InlineError> : null}

            <Overlay.Footer>
              <Button variant="secondary" onClick={() => setFundingOpen(false)}>Cancel</Button>
              <Button busy={fundingBusy} onClick={() => void handleFundFees()}>
                {fundingBusy ? "Signing…" : "Send fees"}
              </Button>
            </Overlay.Footer>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
