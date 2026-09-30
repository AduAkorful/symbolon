"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";

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

  return (
    <div className="max-w-[900px] space-y-10">
      {/* Header */}
      <div>
        <h1 className="font-display text-4xl leading-tight">Steward</h1>
        <p className="mt-2 text-graphite">
          {business.name}’s autonomous agent for payables and cashflow. The Vault enforces policy limits onchain in every mode:
          the Steward cannot withdraw, modify policy, or add payees.
        </p>
      </div>

      {/* Identity & Status Card */}
      <section aria-label="Steward Status" className="rounded-doc border border-rule bg-paper-raised p-6 text-sm">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <span className="block text-xs uppercase tracking-wider text-graphite">Steward Wallet</span>
            {business.stewardWallet ? (
              <span className="mt-1 block font-mono text-xs">
                <TxLink href={`${explorer}/address/${business.stewardWallet}`} label="View Steward wallet on explorer">
                  {business.stewardWallet}
                </TxLink>
              </span>
            ) : (
              <span className="mt-1 block text-amber-500">Not provisioned</span>
            )}
          </div>

          <div>
            <span className="block text-xs uppercase tracking-wider text-graphite">Standing on Chain</span>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  standing.kind === "active"
                    ? "bg-emerald-500"
                    : standing.kind === "paused"
                    ? "bg-red"
                    : "bg-amber-500"
                }`}
              />
              <span className="font-medium capitalize">{standing.kind}</span>
              {standing.block ? (
                <span className="text-xs text-graphite">(block {standing.block})</span>
              ) : null}
            </div>
            {standing.reason ? (
              <p className="mt-1 text-xs text-amber-500">{standing.reason}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-graphite">Fee Balance</span>
              {isOwner ? (
                <button
                  type="button"
                  onClick={() => setFundingOpen(true)}
                  className="text-xs font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink"
                >
                  Fund fees
                </button>
              ) : null}
            </div>
            <span className="mt-1 block font-mono text-xs">{fee.formatted}</span>
            {fee.raw !== null && BigInt(fee.raw) < 10_000_000_000_000_000n ? (
              <span className="mt-1 block text-[11px] text-amber-500">
                Low balance (0.01 USDC recommended for autonomous actions)
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* Mode Picker (S1, S2) */}
      <section aria-labelledby="mode-heading" className="space-y-4">
        <div>
          <h2 id="mode-heading" className="font-display text-2xl">Operating Mode</h2>
          <p className="mt-1 text-xs text-graphite">
            This setting lives in Symbolon. The Vault’s own limits apply in every mode.
          </p>
        </div>

        {modeError ? (
          <p role="alert" className="text-sm text-red">
            {modeError}
          </p>
        ) : null}

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
                className={`rounded-doc border p-5 text-left transition-all ${
                  active
                    ? "border-ink bg-paper-raised ring-1 ring-ink"
                    : "border-rule hover:border-ink/50"
                } ${!isOwner ? "cursor-not-allowed opacity-90" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{m.name}</span>
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full border ${
                      active ? "border-ink" : "border-rule"
                    }`}
                  >
                    {active ? <span className="h-2 w-2 rounded-full bg-ink" /> : null}
                  </span>
                </div>
                <span className="mt-1 block text-xs font-medium text-graphite">{m.tagline}</span>
                <span className="mt-2 block text-xs leading-relaxed text-graphite/90">{m.body}</span>
              </button>
            );
          })}
        </div>
        {!isOwner ? (
          <p className="text-xs text-graphite">Only the business owner can change the Steward’s mode.</p>
        ) : null}
      </section>

      {/* Run Now & Last Run (S6, S11) */}
      <section aria-labelledby="runs-heading" className="space-y-4 border-t border-rule pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="runs-heading" className="font-display text-2xl">Execution Runs</h2>
            <p className="mt-1 text-xs text-graphite">
              Runs happen when you ask; no schedule is set.
            </p>
          </div>
          {canRun ? (
            <button
              type="button"
              disabled={running}
              onClick={() => void handleRunNow()}
              className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity disabled:opacity-40"
            >
              {running ? "Evaluating invoices…" : "Run now"}
            </button>
          ) : null}
        </div>

        {runMessage ? <p className="text-sm text-emerald-600">{runMessage}</p> : null}
        {runError ? <p role="alert" className="text-sm text-red">{runError}</p> : null}

        {lastRun ? (
          <div className="rounded-doc border border-rule p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-graphite">
              <span>
                Last run: <strong className="capitalize text-ink">{lastRun.status}</strong> · Trigger: {lastRun.trigger} · Mode: {lastRun.mode}
              </span>
              <span>{new Date(lastRun.startedAt).toLocaleString()}</span>
            </div>

            {lastRun.error ? (
              <p className="mt-2 text-xs text-red">Reason: {lastRun.error}</p>
            ) : null}

            {lastRun.summary && typeof lastRun.summary === "object" ? (
              <div className="mt-3 flex flex-wrap gap-4 text-xs font-mono">
                {Object.entries(lastRun.summary).map(([k, v]) => {
                  if (typeof v === "object" && v !== null) {
                    return Object.entries(v as Record<string, number>).map(([sk, sv]) => (
                      <span key={sk} className="rounded-sm bg-rule-soft/50 px-2 py-0.5">
                        {sk}: {String(sv)}
                      </span>
                    ));
                  }
                  return (
                    <span key={k} className="rounded-sm bg-rule-soft/50 px-2 py-0.5">
                      {k}: {String(v)}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-graphite">No runs recorded yet.</p>
        )}
      </section>

      {/* Shadow Agreement (Flow 13) */}
      <section aria-labelledby="shadow-heading" className="space-y-4 border-t border-rule pt-8">
        <div>
          <h2 id="shadow-heading" className="font-display text-2xl">Shadow Agreement</h2>
          <p className="mt-1 text-xs text-graphite">
            Compares shadow-mode recommendations with decisions made by your team.
          </p>
        </div>

        {shadow.compared > 0 ? (
          <div className="rounded-doc border border-rule p-5">
            <p className="font-display text-4xl">
              {shadow.agreed} <span className="text-xl text-graphite">of {shadow.compared}</span>
            </p>
            <p className="mt-1 text-sm text-graphite">
              decisions matched team actions ({shadow.rateBps ? (shadow.rateBps / 100).toFixed(1) : 0}%).
            </p>

            {shadow.disagreements.length > 0 ? (
              <div className="mt-4 border-t border-rule-soft pt-3">
                <span className="text-xs font-medium uppercase text-graphite">Disagreements</span>
                <ul className="mt-2 divide-y divide-rule-soft text-xs">
                  {shadow.disagreements.map((d) => (
                    <li key={d.fingerprint} className="py-2 flex items-center justify-between">
                      <span className="font-mono text-graphite">{d.fingerprint.slice(0, 10)}…</span>
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
          <p className="text-xs text-graphite">Nothing to compare yet.</p>
        )}
      </section>

      {/* Recent Decisions (S14) */}
      <section aria-labelledby="decisions-heading" className="space-y-4 border-t border-rule pt-8">
        <div>
          <h2 id="decisions-heading" className="font-display text-2xl">Recent Decisions</h2>
          <p className="mt-1 text-xs text-graphite">
            Every decision is cryptographically recorded with its inputs and rules applied.
          </p>
        </div>

        {recentDecisions.length > 0 ? (
          <ul className="divide-y divide-rule rounded-doc border border-rule text-sm">
            {recentDecisions.map((d) => (
              <li key={d.id} className="p-4 hover:bg-paper-raised/40 transition-colors">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{d.summary.sentence}</span>
                  <span className="text-xs text-graphite">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                {d.summary.explanation ? (
                  <p className="mt-1 text-xs italic text-graphite">{d.summary.explanation}</p>
                ) : null}
                <div className="mt-2 flex items-center gap-3 text-xs font-mono text-graphite">
                  <span>kind: {d.kind}</span>
                  {d.subject ? (
                    <Link
                      href={`/business/inbox/${d.subject}`}
                      className="underline decoration-rule underline-offset-2 hover:text-ink"
                    >
                      invoice {d.subject.slice(0, 8)}…
                    </Link>
                  ) : null}
                  {d.txHash ? (
                    <TxLink href={`${explorer}/tx/${d.txHash}`} label="View transaction on explorer">
                      tx {d.txHash.slice(0, 8)}…
                    </TxLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-graphite">No decisions recorded yet.</p>
        )}
      </section>

      {/* Invariant Bounds: What the Steward can't do (§8.2) */}
      <section aria-labelledby="invariants-heading" className="rounded-doc border border-rule bg-paper-raised/30 p-6 text-sm">
        <h2 id="invariants-heading" className="font-display text-xl">What the Steward Can’t Do</h2>
        <p className="mt-1 text-xs text-graphite">Enforced by the Vault contract onchain in every mode:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-graphite">
          <li>Cannot withdraw funds or pay unapproved recipient addresses</li>
          <li>Cannot modify policy limits, cooldown periods, or approval thresholds</li>
          <li>Cannot add payees, change payout destinations, or register Seals</li>
          <li>Cannot approve payments exceeding the owner threshold without manual human signature</li>
          <li>Cannot pay unsigned documents or bypass pay-once cryptographic records</li>
        </ul>
      </section>

      {/* Autonomous Mode Confirmation Overlay (S1) */}
      {autoModalOpen ? (
        <Overlay
          label="Enable Autonomous Mode"
          onClose={() => setAutoModalOpen(false)}
        >
          <div className="space-y-4 text-sm">
            <h2 className="font-display text-xl text-ink">Enable Autonomous Mode</h2>
            <p className="text-graphite">
              In Autonomous mode, the Steward sends transactions directly to Arc for payments within policy limits.
              The Vault’s onchain policy governs all actions:
            </p>

            <div className="rounded-doc border border-rule bg-paper p-3 text-xs space-y-1.5 font-mono">
              {policyLines.map((line, i) => (
                <div key={i}>• {line}</div>
              ))}
            </div>

            <label className="flex items-start gap-3 rounded-doc border border-rule p-3 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={policyConfirmed}
                onChange={(e) => setPolicyConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-rule text-ink"
              />
              <span>
                I understand that the Steward will autonomously execute payments according to the policy rules above.
              </span>
            </label>

            {modeError ? <p className="text-xs text-red">{modeError}</p> : null}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAutoModalOpen(false)}
                className="rounded-doc border border-rule px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!policyConfirmed || modePending}
                onClick={() => void confirmAutoMode()}
                className="rounded-doc bg-ink px-4 py-2 text-xs font-medium text-paper transition-opacity disabled:opacity-40"
              >
                {modePending ? "Enabling…" : "Confirm & Enable"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}

      {/* Fee Funding Overlay (S5) */}
      {fundingOpen ? (
        <Overlay
          label="Fund Steward Network Fees"
          onClose={() => setFundingOpen(false)}
        >
          <div className="space-y-4 text-sm">
            <h2 className="font-display text-xl text-ink">Fund Steward Network Fees</h2>
            <p className="text-graphite">
              Arc gas is paid in native USDC. Send a small amount from your owner wallet to fund the Steward’s transactions:
            </p>

            <div>
              <label htmlFor="fee-amount-input" className="block text-xs uppercase tracking-wider text-graphite">
                Amount (USDC)
              </label>
              <input
                id="fee-amount-input"
                type="text"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                className="mt-1 w-full rounded-doc border border-rule bg-transparent px-3 py-2 text-sm font-mono text-ink outline-none focus:border-ink"
                placeholder="0.1"
              />
              <span className="mt-1 block text-[11px] text-graphite">
                Recommended: 0.1 USDC (covers hundreds of transactions)
              </span>
            </div>

            {fundingError ? <p className="text-xs text-red">{fundingError}</p> : null}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFundingOpen(false)}
                className="rounded-doc border border-rule px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={fundingBusy}
                onClick={() => void handleFundFees()}
                className="rounded-doc bg-ink px-4 py-2 text-xs font-medium text-paper transition-opacity disabled:opacity-40"
              >
                {fundingBusy ? "Signing transfer…" : "Send fees (one signature)"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
