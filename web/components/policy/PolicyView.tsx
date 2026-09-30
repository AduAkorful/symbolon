"use client";

import { useState } from "react";
import Link from "next/link";
import { TxLink } from "@/components/TxLink";
import { QueuedChange } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { PolicyViewData } from "@/lib/server/policy-edit";
import type { BudgetViewItem } from "@/lib/server/budgets";
import { policyTemplate, type PolicyTemplate } from "@/lib/policy-template";
import { usd, duration } from "@/lib/format";
import { isLooseningPolicy } from "@/lib/server/loosening";


interface PolicyViewProps extends PolicyViewData {
  businessId: string;
  businessName: string;
  isOwner: boolean;
  signer: SignerPlan;
  budgets: BudgetViewItem[];
  explorerUrl?: string;
}

export function PolicyView({
  businessId,
  businessName,
  isOwner,
  signer,
  rules,
  policy,
  lines,
  looseningDelaySeconds,
  pendingChange,
  warnings: initialWarnings,
  budgets: initialBudgets,
}: PolicyViewProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form draft state in user-friendly units
  const [draftPerTxCap, setDraftPerTxCap] = useState(String(Number(policy.perTxCap) / 1e6));
  const [draftOwnerThreshold, setDraftOwnerThreshold] = useState(String(Number(policy.ownerThreshold) / 1e6));
  const [draftAutoPayLimit, setDraftAutoPayLimit] = useState(String(Number(policy.autoPayLimit) / 1e6));
  const [draftNewVendorMinPaid, setDraftNewVendorMinPaid] = useState(policy.newVendorMinPaid);
  const [draftScreeningMaxAge, setDraftScreeningMaxAge] = useState(policy.screeningMaxAge);
  const [draftNewPayeeDelay, setDraftNewPayeeDelay] = useState(policy.newPayeeDelay);
  const [draftChangeCooldown, setDraftChangeCooldown] = useState(policy.changeCooldown);
  const [draftLooseningDelay, setDraftLooseningDelay] = useState(policy.looseningDelay);
  const [draftMaxBridgeFee, setDraftMaxBridgeFee] = useState(String(Number(policy.maxBridgeFee) / 1e6));

  // Budgets state
  const [budgets, setBudgets] = useState<BudgetViewItem[]>(initialBudgets);
  const [creatingBudget, setCreatingBudget] = useState(false);
  const [budgetName, setBudgetName] = useState("");
  const [budgetCap, setBudgetCap] = useState("10000");
  const [budgetPeriod, setBudgetPeriod] = useState("2592000"); // 30 days default

  const getProviders = useWalletProviders();

  // Template prefill
  function handlePrefillTemplate(tmpl: PolicyTemplate) {
    const t = policyTemplate(tmpl);
    setDraftPerTxCap(String(Number(t.perTxCap) / 1e6));
    setDraftOwnerThreshold(String(Number(t.ownerThreshold) / 1e6));
    setDraftAutoPayLimit(String(Number(t.autoPayLimit) / 1e6));
    setDraftNewVendorMinPaid(t.newVendorMinPaid);
    setDraftScreeningMaxAge(t.screeningMaxAge.toString());
    setDraftNewPayeeDelay(t.newPayeeDelay.toString());
    setDraftChangeCooldown(t.changeCooldown.toString());
    setDraftLooseningDelay(t.looseningDelay.toString());
    setDraftMaxBridgeFee(t.maxBridgeFee.toString());
  }

  // Compute draft bigints and whether proposed is looser
  const draftPolicyRaw = {
    perTxCap: BigInt(Math.floor(Number(draftPerTxCap || 0) * 1e6)),
    autoPayLimit: BigInt(Math.floor(Number(draftAutoPayLimit || 0) * 1e6)),
    ownerThreshold: BigInt(Math.floor(Number(draftOwnerThreshold || 0) * 1e6)),
    newVendorMinPaid: Number(draftNewVendorMinPaid),
    screeningMaxAge: BigInt(draftScreeningMaxAge),
    newPayeeDelay: BigInt(draftNewPayeeDelay),
    changeCooldown: BigInt(draftChangeCooldown),
    looseningDelay: BigInt(draftLooseningDelay),
    maxBridgeFee: BigInt(Math.floor(Number(draftMaxBridgeFee || 0) * 1e6)),
  };

  const currentPolicyRaw = {
    perTxCap: BigInt(policy.perTxCap),
    autoPayLimit: BigInt(policy.autoPayLimit),
    ownerThreshold: BigInt(policy.ownerThreshold),
    newVendorMinPaid: policy.newVendorMinPaid,
    screeningMaxAge: BigInt(policy.screeningMaxAge),
    newPayeeDelay: BigInt(policy.newPayeeDelay),
    changeCooldown: BigInt(policy.changeCooldown),
    looseningDelay: BigInt(policy.looseningDelay),
    maxBridgeFee: BigInt(policy.maxBridgeFee),
  };

  const isLooser = isLooseningPolicy(currentPolicyRaw, draftPolicyRaw);

  // Field-level comparison helper
  function fieldDelta(current: bigint | number, draft: bigint | number, looserWhen: "higher" | "lower") {
    const c = BigInt(current);
    const d = BigInt(draft);
    if (c === d) return { label: "unchanged", color: "text-graphite" };
    const looser = looserWhen === "higher" ? d > c : d < c;
    return looser
      ? { label: "looser", color: "text-amber-600 font-medium" }
      : { label: "tighter", color: "text-emerald-600 font-medium" };
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      alert("Please connect the business owner's wallet to submit policy changes.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatusMessage("Preparing policy change...");

    try {
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
        state: string;
        isLooser: boolean;
        summary: Record<string, unknown>;
      }>(`/api/business/${businessId}/policy`, {
        action: "prepare",
        policy: {
          perTxCap: draftPolicyRaw.perTxCap.toString(),
          autoPayLimit: draftPolicyRaw.autoPayLimit.toString(),
          ownerThreshold: draftPolicyRaw.ownerThreshold.toString(),
          newVendorMinPaid: draftPolicyRaw.newVendorMinPaid,
          screeningMaxAge: draftPolicyRaw.screeningMaxAge.toString(),
          newPayeeDelay: draftPolicyRaw.newPayeeDelay.toString(),
          changeCooldown: draftPolicyRaw.changeCooldown.toString(),
          looseningDelay: draftPolicyRaw.looseningDelay.toString(),
          maxBridgeFee: draftPolicyRaw.maxBridgeFee.toString(),
        },
      });

      setStatusMessage("Please confirm transaction in your wallet...");
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      setStatusMessage("Recording transaction on server...");
      await postJson(`/api/business/${businessId}/policy`, {
        action: "record",
        txHash,
      });

      setStatusMessage("Policy updated successfully.");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Failed to update policy.");
      setStatusMessage(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBudget(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      alert("Please connect the business owner's wallet to create a budget.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatusMessage("Preparing budget transaction...");

    try {
      const capRaw = BigInt(Math.floor(Number(budgetCap) * 1e6));
      const periodLen = BigInt(budgetPeriod);

      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
        state: string;
      }>(`/api/business/${businessId}/budgets`, {
        action: "prepare-create",
        name: budgetName.trim(),
        cap: capRaw.toString(),
        periodLength: periodLen.toString(),
      });

      setStatusMessage("Please confirm transaction in your wallet...");
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      setStatusMessage("Recording budget...");
      await postJson(`/api/business/${businessId}/budgets`, {
        action: "record-create",
        name: budgetName.trim(),
        txHash,
      });

      setStatusMessage("Budget created successfully.");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Failed to create budget.");
      setStatusMessage(null);
    } finally {
      setBusy(false);
    }
  }

  const groups = [
    "Paying without a person",
    "Who gets paid",
    "Changing these rules",
    "Cross-chain",
  ];

  return (
    <article className="mx-auto max-w-[960px] pb-24 pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">
            {businessName} · Security Controls
          </p>
          <h1 className="mt-2 font-display text-4xl">Policy</h1>
        </div>
        {isOwner ? (
          <button
            onClick={() => setEditing(!editing)}
            className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            {editing ? "Close editor" : "Edit policy"}
          </button>
        ) : null}
      </div>

      <p className="mt-4 max-w-[75ch] text-graphite text-sm leading-relaxed">
        The rules {businessName}’s Vault enforces for every payment, whoever or whatever asks.
        Making a rule stricter applies at once; making it looser waits for the Vault’s loosening delay, so a stolen session cannot widen limits and drain funds immediately.
      </p>

      {/* Sanity or status notices */}
      {statusMessage ? (
        <div role="status" className="mt-6 rounded-doc border border-seal/40 bg-seal-wash/50 p-4 text-sm">
          {statusMessage}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-6 rounded-doc border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {initialWarnings.length > 0 ? (
        <div className="mt-6 space-y-2 rounded-doc border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Policy considerations:</p>
          <ul className="list-inside list-disc space-y-1 text-xs">
            {initialWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Waiting to apply change */}
      {pendingChange ? (
        <section className="mt-8 rounded-doc border border-amber-300 bg-amber-50/60 p-5">
          <h2 className="font-display text-xl text-amber-950">A policy change is queued</h2>
          <p className="mt-1 text-sm text-amber-900">
            A loosening policy update was queued onchain and will become ready to apply once the loosening delay passes.
          </p>
          <div className="mt-4">
            <QueuedChange
              businessId={businessId}
              changeId={pendingChange.changeId}
              kind="set_policy"
              state={pendingChange.ready ? "ready" : "will-queue"}
              eta={pendingChange.eta}
              looseningDelaySeconds={looseningDelaySeconds}
              summary={pendingChange.summary}
              signer={signer}
              onApplied={() => window.location.reload()}
              onCancelled={() => window.location.reload()}
            />
          </div>
        </section>
      ) : null}

      {/* Edit Form Sheet */}
      {editing ? (
        <section className="mt-8 rounded-doc border-2 border-ink/20 bg-paper-raised p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
            <div>
              <h2 className="font-display text-2xl">Edit Vault Policy</h2>
              <p className="text-xs text-graphite">
                Preset templates prefill these fields below. They are not applied until you review and sign.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-graphite font-mono uppercase tracking-wider">Presets:</span>
              <button
                type="button"
                onClick={() => handlePrefillTemplate("starter")}
                className="rounded-doc border border-rule px-2.5 py-1 text-xs hover:bg-paper"
              >
                Starter
              </button>
              <button
                type="button"
                onClick={() => handlePrefillTemplate("standard")}
                className="rounded-doc border border-rule px-2.5 py-1 text-xs hover:bg-paper"
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => handlePrefillTemplate("strict")}
                className="rounded-doc border border-rule px-2.5 py-1 text-xs hover:bg-paper"
              >
                Strict
              </button>
            </div>
          </div>

          <form onSubmit={handleSavePolicy} className="mt-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              {/* perTxCap */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="perTxCap" className="font-medium text-sm">
                    Largest single payment ($)
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.perTxCap, draftPolicyRaw.perTxCap, "higher").color}`}>
                    {fieldDelta(currentPolicyRaw.perTxCap, draftPolicyRaw.perTxCap, "higher").label}
                  </span>
                </div>
                <input
                  id="perTxCap"
                  type="number"
                  step="any"
                  value={draftPerTxCap}
                  onChange={(e) => setDraftPerTxCap(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                  required
                />
                <p className="mt-1 text-xs text-graphite">No single outflow may ever exceed this amount.</p>
              </div>

              {/* ownerThreshold */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="ownerThreshold" className="font-medium text-sm">
                    Owner signs above ($)
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.ownerThreshold, draftPolicyRaw.ownerThreshold, "higher").color}`}>
                    {fieldDelta(currentPolicyRaw.ownerThreshold, draftPolicyRaw.ownerThreshold, "higher").label}
                  </span>
                </div>
                <input
                  id="ownerThreshold"
                  type="number"
                  step="any"
                  value={draftOwnerThreshold}
                  onChange={(e) => setDraftOwnerThreshold(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                  required
                />
                <p className="mt-1 text-xs text-graphite">Invoices between auto-pay and this need an approver; above this, the owner.</p>
              </div>

              {/* autoPayLimit */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="autoPayLimit" className="font-medium text-sm">
                    Auto-pay limit ($)
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.autoPayLimit, draftPolicyRaw.autoPayLimit, "higher").color}`}>
                    {fieldDelta(currentPolicyRaw.autoPayLimit, draftPolicyRaw.autoPayLimit, "higher").label}
                  </span>
                </div>
                <input
                  id="autoPayLimit"
                  type="number"
                  step="any"
                  value={draftAutoPayLimit}
                  onChange={(e) => setDraftAutoPayLimit(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                  required
                />
                <p className="mt-1 text-xs text-graphite">Up to this amount can settle without human sign-off if requirements match.</p>
              </div>

              {/* newVendorMinPaid */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="newVendorMinPaid" className="font-medium text-sm">
                    New vendor invoice threshold
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.newVendorMinPaid, draftPolicyRaw.newVendorMinPaid, "lower").color}`}>
                    {fieldDelta(currentPolicyRaw.newVendorMinPaid, draftPolicyRaw.newVendorMinPaid, "lower").label}
                  </span>
                </div>
                <input
                  id="newVendorMinPaid"
                  type="number"
                  min="0"
                  step="1"
                  value={draftNewVendorMinPaid}
                  onChange={(e) => setDraftNewVendorMinPaid(Number(e.target.value))}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                  required
                />
                <p className="mt-1 text-xs text-graphite">Number of invoices a vendor must successfully clear before qualifying for auto-pay.</p>
              </div>

              {/* screeningMaxAge */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="screeningMaxAge" className="font-medium text-sm">
                    Screening max age
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.screeningMaxAge, draftPolicyRaw.screeningMaxAge, "higher").color}`}>
                    {fieldDelta(currentPolicyRaw.screeningMaxAge, draftPolicyRaw.screeningMaxAge, "higher").label}
                  </span>
                </div>
                <select
                  id="screeningMaxAge"
                  value={draftScreeningMaxAge}
                  onChange={(e) => setDraftScreeningMaxAge(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                >
                  <option value="0">Not required (0 days — loosest)</option>
                  <option value={String(7 * 86400)}>7 days</option>
                  <option value={String(14 * 86400)}>14 days</option>
                  <option value={String(30 * 86400)}>30 days</option>
                  <option value={String(60 * 86400)}>60 days</option>
                  <option value={String(90 * 86400)}>90 days</option>
                </select>
                <p className="mt-1 text-xs text-graphite">
                  Payees need screening within this window. See{" "}
                  <Link href="/business/compliance" className="underline underline-offset-2">
                    Compliance
                  </Link>{" "}
                  for screening status.
                </p>
              </div>

              {/* newPayeeDelay */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="newPayeeDelay" className="font-medium text-sm">
                    New payee delay
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.newPayeeDelay, draftPolicyRaw.newPayeeDelay, "lower").color}`}>
                    {fieldDelta(currentPolicyRaw.newPayeeDelay, draftPolicyRaw.newPayeeDelay, "lower").label}
                  </span>
                </div>
                <select
                  id="newPayeeDelay"
                  value={draftNewPayeeDelay}
                  onChange={(e) => setDraftNewPayeeDelay(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                >
                  <option value="0">Immediate (0 delay)</option>
                  <option value={String(12 * 3600)}>12 hours</option>
                  <option value={String(24 * 3600)}>24 hours</option>
                  <option value={String(48 * 3600)}>48 hours</option>
                  <option value={String(72 * 3600)}>72 hours</option>
                </select>
                <p className="mt-1 text-xs text-graphite">Wait time before a newly added payee can receive their first payment.</p>
              </div>

              {/* changeCooldown */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="changeCooldown" className="font-medium text-sm">
                    Payout & Seal change cooldown
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.changeCooldown, draftPolicyRaw.changeCooldown, "lower").color}`}>
                    {fieldDelta(currentPolicyRaw.changeCooldown, draftPolicyRaw.changeCooldown, "lower").label}
                  </span>
                </div>
                <select
                  id="changeCooldown"
                  value={draftChangeCooldown}
                  onChange={(e) => setDraftChangeCooldown(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                >
                  <option value={String(24 * 3600)}>24 hours</option>
                  <option value={String(48 * 3600)}>48 hours</option>
                  <option value={String(72 * 3600)}>72 hours</option>
                  <option value={String(7 * 86400)}>7 days</option>
                </select>
                <p className="mt-1 text-xs text-graphite">Cooldown window for vendor payout address or Seal rotation requests.</p>
              </div>

              {/* looseningDelay */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="looseningDelay" className="font-medium text-sm">
                    Loosening change delay
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.looseningDelay, draftPolicyRaw.looseningDelay, "lower").color}`}>
                    {fieldDelta(currentPolicyRaw.looseningDelay, draftPolicyRaw.looseningDelay, "lower").label}
                  </span>
                </div>
                <select
                  id="looseningDelay"
                  value={draftLooseningDelay}
                  onChange={(e) => setDraftLooseningDelay(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                >
                  <option value="0">Immediate (0 delay — caution)</option>
                  <option value={String(12 * 3600)}>12 hours</option>
                  <option value={String(24 * 3600)}>24 hours</option>
                  <option value={String(48 * 3600)}>48 hours</option>
                  <option value={String(72 * 3600)}>72 hours</option>
                </select>
                <p className="mt-1 text-xs text-graphite">Time looser policy changes must wait in queue before they can be applied.</p>
              </div>

              {/* maxBridgeFee */}
              <div className="rounded-doc border border-rule p-4">
                <div className="flex items-center justify-between">
                  <label htmlFor="maxBridgeFee" className="font-medium text-sm">
                    Max cross-chain bridge fee ($)
                  </label>
                  <span className={`text-xs ${fieldDelta(currentPolicyRaw.maxBridgeFee, draftPolicyRaw.maxBridgeFee, "higher").color}`}>
                    {fieldDelta(currentPolicyRaw.maxBridgeFee, draftPolicyRaw.maxBridgeFee, "higher").label}
                  </span>
                </div>
                <input
                  id="maxBridgeFee"
                  type="number"
                  step="any"
                  value={draftMaxBridgeFee}
                  onChange={(e) => setDraftMaxBridgeFee(e.target.value)}
                  className="mt-2 w-full rounded border border-ink/40 bg-paper px-3 py-1.5 text-sm"
                  required
                />
                <p className="mt-1 text-xs text-graphite">Maximum CCTP bridge fee permitted per cross-chain payment.</p>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-4">
              <div>
                <p className="text-sm font-medium">
                  {isLooser ? (
                    <span className="text-amber-700">
                      Looser policy: this change will be queued and must wait {duration(BigInt(policy.looseningDelay))}.
                    </span>
                  ) : (
                    <span className="text-emerald-700">
                      Tighter policy: this change will apply immediately upon signing.
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                  className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-doc bg-ink px-5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Processing..." : isLooser ? "Queue change" : "Apply now"}
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {/* Rules list */}
      <section className="mt-10 space-y-10">
        {groups.map((group) => {
          const groupRules = rules.filter((r) => r.group === group);
          if (!groupRules.length) return null;
          return (
            <div key={group}>
              <h2 className="font-display text-2xl">{group}</h2>
              <ul className="mt-3 divide-y divide-rule border-y border-rule">
                {groupRules.map((rule) => (
                  <li key={rule.id} className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-medium text-sm">{rule.name}</p>
                      <p className="text-xs text-graphite">{rule.note}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-medium">{rule.formatted}</p>
                      <p className="font-mono text-[11px] text-graphite">raw: {rule.raw}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Budgets Section */}
      <section className="mt-16 border-t border-rule pt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">Budgets</h2>
            <p className="mt-1 text-sm text-graphite">
              Caps on spending from {businessName}’s single Vault balance, not separated bank accounts.
              Periods are fixed-length windows (e.g. 30 days), epoch-aligned onchain.
            </p>
          </div>
          {isOwner ? (
            <button
              onClick={() => setCreatingBudget(!creatingBudget)}
              className="rounded-doc border border-ink bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink hover:text-paper"
            >
              {creatingBudget ? "Cancel" : "New budget"}
            </button>
          ) : null}
        </div>

        {creatingBudget ? (
          <form onSubmit={handleCreateBudget} className="mt-6 rounded-doc border border-ink/20 bg-paper-raised p-5">
            <h3 className="font-display text-lg">Create a New Budget</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="budgetName" className="block text-xs font-medium text-graphite">
                  Budget name
                </label>
                <input
                  id="budgetName"
                  type="text"
                  placeholder="e.g. Marketing, Engineering"
                  value={budgetName}
                  onChange={(e) => setBudgetName(e.target.value)}
                  className="mt-1 w-full rounded border border-rule bg-paper px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="budgetCap" className="block text-xs font-medium text-graphite">
                  Cap ($)
                </label>
                <input
                  id="budgetCap"
                  type="number"
                  step="any"
                  value={budgetCap}
                  onChange={(e) => setBudgetCap(e.target.value)}
                  className="mt-1 w-full rounded border border-rule bg-paper px-3 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label htmlFor="budgetPeriod" className="block text-xs font-medium text-graphite">
                  Period window
                </label>
                <select
                  id="budgetPeriod"
                  value={budgetPeriod}
                  onChange={(e) => setBudgetPeriod(e.target.value)}
                  className="mt-1 w-full rounded border border-rule bg-paper px-3 py-1.5 text-sm"
                >
                  <option value={String(7 * 86400)}>7-day period</option>
                  <option value={String(30 * 86400)}>30-day period</option>
                  <option value={String(90 * 86400)}>90-day period</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreatingBudget(false)}
                className="rounded-doc border border-rule px-3 py-1.5 text-xs text-graphite"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-doc bg-ink px-4 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creating..." : "Create budget"}
              </button>
            </div>
          </form>
        ) : null}

        <div className="mt-6 divide-y divide-rule border-y border-rule">
          {budgets.map((b) => (
            <div key={b.id} className="grid gap-3 py-4 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-center">
              <div>
                <p className="font-medium text-sm flex items-center gap-2">
                  <span>{b.name}</span>
                  {b.isOperating ? (
                    <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-mono uppercase text-ink">
                      Default
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-graphite">{b.periodLengthLabel}</p>
              </div>
              <div>
                <p className="text-xs text-graphite">Spent in period</p>
                <p className="font-mono text-sm font-medium">{b.spent}</p>
              </div>
              <div>
                <p className="text-xs text-graphite">Cap</p>
                <p className="font-mono text-sm font-medium">{b.cap}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-graphite">Remaining</p>
                <p className="font-mono text-sm font-medium">{b.remaining}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
