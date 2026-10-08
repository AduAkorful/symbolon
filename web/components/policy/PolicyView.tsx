"use client";

import { useState } from "react";
import Link from "next/link";
import { QueuedChange } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { PolicyViewData } from "@/lib/server/policy-edit";
import type { BudgetViewItem } from "@/lib/server/budgets";
import { policyTemplate, type PolicyTemplate } from "@/lib/policy-template";
import { moneyDraft, moneyInput } from "@/lib/money-draft";
import { usd, duration } from "@/lib/format";
import { isLooseningPolicy } from "@/lib/server/loosening";
import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { controlClass, Field, type FieldAria } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";


interface PolicyViewProps extends PolicyViewData {
  businessId: string;
  businessName: string;
  isOwner: boolean;
  signer: SignerPlan;
  budgets: BudgetViewItem[];
  explorerUrl?: string;
}

/** Whether a draft value is looser or tighter than the Vault's current one */
function fieldDelta(current: bigint | number, draft: bigint | number, looserWhen: "higher" | "lower") {
  const c = BigInt(current);
  const d = BigInt(draft);
  if (c === d) return { label: "unchanged", color: "text-graphite" };
  const looser = looserWhen === "higher" ? d > c : d < c;
  return looser
    ? { label: "looser", color: "text-warn font-medium" }
    : { label: "tighter", color: "text-ok font-medium" };
}


/** A policy setting in the editor: its label, whether the draft is looser or tighter than the Vault's, the control and a hint */
function PolicyField({ id, label, current, draft, looserWhen, hint, children }: { id: string; label: string; current: bigint | number; draft: bigint | number; looserWhen: "higher" | "lower"; hint: React.ReactNode; children: (a: FieldAria) => React.ReactNode }) {
  const delta = fieldDelta(current, draft, looserWhen);
  return (
    <Field label={<span className="flex flex-wrap items-baseline justify-between gap-x-3"><span>{label}</span><span className={`text-xs font-normal ${delta.color}`}>{delta.label}</span></span>} hint={hint}>
      {(a) => children(a)}
    </Field>
  );
}


export function PolicyView({
  businessId,
  businessName,
  isOwner,
  signer,
  rules,
  accountingDecimals,
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
  const [draftPerTxCap, setDraftPerTxCap] = useState(moneyInput(policy.perTxCap, accountingDecimals));
  const [draftOwnerThreshold, setDraftOwnerThreshold] = useState(moneyInput(policy.ownerThreshold, accountingDecimals));
  const [draftAutoPayLimit, setDraftAutoPayLimit] = useState(moneyInput(policy.autoPayLimit, accountingDecimals));
  const [draftNewVendorMinPaid, setDraftNewVendorMinPaid] = useState(policy.newVendorMinPaid);
  const [draftScreeningMaxAge, setDraftScreeningMaxAge] = useState(policy.screeningMaxAge);
  const [draftNewPayeeDelay, setDraftNewPayeeDelay] = useState(policy.newPayeeDelay);
  const [draftChangeCooldown, setDraftChangeCooldown] = useState(policy.changeCooldown);
  const [draftLooseningDelay, setDraftLooseningDelay] = useState(policy.looseningDelay);
  const [draftMaxBridgeFee, setDraftMaxBridgeFee] = useState(moneyInput(policy.maxBridgeFee, accountingDecimals));

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
    setDraftPerTxCap(moneyInput(t.perTxCap, accountingDecimals));
    setDraftOwnerThreshold(moneyInput(t.ownerThreshold, accountingDecimals));
    setDraftAutoPayLimit(moneyInput(t.autoPayLimit, accountingDecimals));
    setDraftNewVendorMinPaid(t.newVendorMinPaid);
    setDraftScreeningMaxAge(t.screeningMaxAge.toString());
    setDraftNewPayeeDelay(t.newPayeeDelay.toString());
    setDraftChangeCooldown(t.changeCooldown.toString());
    setDraftLooseningDelay(t.looseningDelay.toString());
    setDraftMaxBridgeFee(moneyInput(t.maxBridgeFee, accountingDecimals));
  }

  // Compute draft bigints and whether proposed is looser
  let draftError: string | null = null;
  const draftPolicyRaw = (() => { try { if (!Number.isInteger(draftNewVendorMinPaid)) throw new Error("Invalid count"); return {
    perTxCap: parseMoney(draftPerTxCap),
    autoPayLimit: parseMoney(draftAutoPayLimit),
    ownerThreshold: parseMoney(draftOwnerThreshold),
    newVendorMinPaid: Number(draftNewVendorMinPaid),
    screeningMaxAge: BigInt(draftScreeningMaxAge),
    newPayeeDelay: BigInt(draftNewPayeeDelay),
    changeCooldown: BigInt(draftChangeCooldown),
    looseningDelay: BigInt(draftLooseningDelay),
    maxBridgeFee: parseMoney(draftMaxBridgeFee),
  }; } catch { draftError = "Enter valid exact amounts and whole-number durations."; return null; } })();

  function parseMoney(value: string) { const result = moneyDraft(value, accountingDecimals); if (result.raw === undefined) throw new Error(result.error); return result.raw; }

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

  const isLooser = draftPolicyRaw ? isLooseningPolicy(currentPolicyRaw, draftPolicyRaw) : false;

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      setError("Connect the owner’s wallet to change the policy.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatusMessage("Preparing policy change...");

    try {
      if (!draftPolicyRaw) throw new Error(draftError ?? "Invalid policy amounts.");
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
          perTxCap: (draftPolicyRaw ?? currentPolicyRaw).perTxCap.toString(),
          autoPayLimit: (draftPolicyRaw ?? currentPolicyRaw).autoPayLimit.toString(),
          ownerThreshold: (draftPolicyRaw ?? currentPolicyRaw).ownerThreshold.toString(),
          newVendorMinPaid: (draftPolicyRaw ?? currentPolicyRaw).newVendorMinPaid,
          screeningMaxAge: (draftPolicyRaw ?? currentPolicyRaw).screeningMaxAge.toString(),
          newPayeeDelay: (draftPolicyRaw ?? currentPolicyRaw).newPayeeDelay.toString(),
          changeCooldown: (draftPolicyRaw ?? currentPolicyRaw).changeCooldown.toString(),
          looseningDelay: (draftPolicyRaw ?? currentPolicyRaw).looseningDelay.toString(),
          maxBridgeFee: (draftPolicyRaw ?? currentPolicyRaw).maxBridgeFee.toString(),
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
      setError("Connect the owner’s wallet to create a budget.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatusMessage("Preparing budget transaction...");

    try {
      const capRaw = parseMoney(budgetCap);
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

  const draftNow = draftPolicyRaw ?? currentPolicyRaw;

  const seconds = (n: number) => String(n);

  return (
    <article className="pb-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Policy</PageTitle>
          <Lead className="mt-3">
            The rules {businessName}’s Vault enforces for every payment, whoever or whatever asks. A stricter rule applies at once; a looser one waits for
            the Vault’s loosening delay, so a stolen session can’t widen the limits and drain funds immediately.
          </Lead>
        </div>
        {isOwner ? <Button onClick={() => setEditing(true)}>Edit policy</Button> : null}
      </div>

      {statusMessage ? <Callout tone="info" className="mt-6">{statusMessage}</Callout> : null}
      {!editing && (error || draftError) ? <Callout tone="danger" className="mt-6">{error || draftError}</Callout> : null}

      {initialWarnings.length > 0 ? (
        <Callout tone="warn" title="Worth a look" className="mt-6">
          <ul className="list-inside list-disc space-y-1">
            {initialWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {/* A change waiting to apply */}
      {pendingChange ? (
        <Callout tone="warn" title="A policy change is waiting" className="mt-6">
          <p>A looser policy was queued onchain. It can be applied once the loosening delay has passed.</p>
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
        </Callout>
      ) : null}

      {/* The editor */}
      {editing ? (
        <Overlay title="Edit the Vault’s policy" description="Presets fill in the fields below. Nothing changes until you review and sign." size="lg" onClose={() => { if (!busy) setEditing(false); }}>
          <form onSubmit={handleSavePolicy} className="space-y-5">
            {error || draftError ? <InlineError>{error || draftError}</InlineError> : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-graphite">Start from</span>
              {(["starter", "standard", "strict"] as const).map((t) => (
                <Button key={t} variant="secondary" size="sm" onClick={() => handlePrefillTemplate(t)}>{t[0]!.toUpperCase() + t.slice(1)}</Button>
              ))}
            </div>

            <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
              <PolicyField id="perTxCap" label="Largest single payment ($)" current={currentPolicyRaw.perTxCap} draft={draftNow.perTxCap} looserWhen="higher" hint="No single payment may ever exceed this.">
                {(a) => <input {...a} type="number" step="any" value={draftPerTxCap} onChange={(e) => setDraftPerTxCap(e.target.value)} className={controlClass} required />}
              </PolicyField>
              <PolicyField id="ownerThreshold" label="Owner signs above ($)" current={currentPolicyRaw.ownerThreshold} draft={draftNow.ownerThreshold} looserWhen="higher" hint="Between the auto-pay limit and this, an approver signs; above it, the owner.">
                {(a) => <input {...a} type="number" step="any" value={draftOwnerThreshold} onChange={(e) => setDraftOwnerThreshold(e.target.value)} className={controlClass} required />}
              </PolicyField>
              <PolicyField id="autoPayLimit" label="Auto-pay limit ($)" current={currentPolicyRaw.autoPayLimit} draft={draftNow.autoPayLimit} looserWhen="higher" hint="Up to this, a payment can settle with no one signing, if every other rule holds.">
                {(a) => <input {...a} type="number" step="any" value={draftAutoPayLimit} onChange={(e) => setDraftAutoPayLimit(e.target.value)} className={controlClass} required />}
              </PolicyField>
              <PolicyField id="newVendorMinPaid" label="Invoices before a vendor is trusted" current={currentPolicyRaw.newVendorMinPaid} draft={draftNow.newVendorMinPaid} looserWhen="lower" hint="How many invoices a vendor must have been paid for before auto-pay applies.">
                {(a) => <input {...a} type="number" min="0" step="1" value={draftNewVendorMinPaid} onChange={(e) => setDraftNewVendorMinPaid(Number(e.target.value))} className={controlClass} required />}
              </PolicyField>
              <PolicyField id="screeningMaxAge" label="Newest screening allowed" current={currentPolicyRaw.screeningMaxAge} draft={draftNow.screeningMaxAge} looserWhen="higher" hint={<>Payees must have been screened within this time. See <Link href="/business/compliance" className="underline underline-offset-2">Compliance</Link>.</>}>
                {(a) => (
                  <select {...a} value={draftScreeningMaxAge} onChange={(e) => setDraftScreeningMaxAge(e.target.value)} className={controlClass}>
                    <option value="0">Not required</option>
                    {[7, 14, 30, 60, 90].map((d) => <option key={d} value={seconds(d * 86400)}>{d} days</option>)}
                  </select>
                )}
              </PolicyField>
              <PolicyField id="newPayeeDelay" label="Wait before a new payee is paid" current={currentPolicyRaw.newPayeeDelay} draft={draftNow.newPayeeDelay} looserWhen="lower" hint="Time between adding a payee and their first payment.">
                {(a) => (
                  <select {...a} value={draftNewPayeeDelay} onChange={(e) => setDraftNewPayeeDelay(e.target.value)} className={controlClass}>
                    <option value="0">No wait</option>
                    {[12, 24, 48, 72].map((h) => <option key={h} value={seconds(h * 3600)}>{h} hours</option>)}
                  </select>
                )}
              </PolicyField>
              <PolicyField id="changeCooldown" label="Wait before a payout change takes effect" current={currentPolicyRaw.changeCooldown} draft={draftNow.changeCooldown} looserWhen="lower" hint="Applies to a vendor’s new payout address or new Seal.">
                {(a) => (
                  <select {...a} value={draftChangeCooldown} onChange={(e) => setDraftChangeCooldown(e.target.value)} className={controlClass}>
                    {[24, 48, 72].map((h) => <option key={h} value={seconds(h * 3600)}>{h} hours</option>)}
                    <option value={seconds(7 * 86400)}>7 days</option>
                  </select>
                )}
              </PolicyField>
              <PolicyField id="looseningDelay" label="Wait before a looser rule applies" current={currentPolicyRaw.looseningDelay} draft={draftNow.looseningDelay} looserWhen="lower" hint="How long a looser change waits in the queue. A short wait gives a thief less to wait out.">
                {(a) => (
                  <select {...a} value={draftLooseningDelay} onChange={(e) => setDraftLooseningDelay(e.target.value)} className={controlClass}>
                    <option value="0">No wait (risky)</option>
                    {[12, 24, 48, 72].map((h) => <option key={h} value={seconds(h * 3600)}>{h} hours</option>)}
                  </select>
                )}
              </PolicyField>
              <PolicyField id="maxBridgeFee" label="Most to pay in cross-chain fees ($)" current={currentPolicyRaw.maxBridgeFee} draft={draftNow.maxBridgeFee} looserWhen="higher" hint="The largest CCTP fee one cross-chain payment may cost.">
                {(a) => <input {...a} type="number" step="any" value={draftMaxBridgeFee} onChange={(e) => setDraftMaxBridgeFee(e.target.value)} className={controlClass} required />}
              </PolicyField>
            </div>

            <p className={isLooser ? "text-warn" : "text-ok"}>
              {isLooser
                ? `A looser policy: it is queued and has to wait ${duration(BigInt(policy.looseningDelay))} before you can apply it.`
                : "A tighter or equal policy: it applies as soon as you sign."}
            </p>

            <Overlay.Footer>
              <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" busy={busy}>{busy ? "Working…" : isLooser ? "Queue the change" : "Apply now"}</Button>
            </Overlay.Footer>
          </form>
        </Overlay>
      ) : null}

      {/* The rules */}
      <section className="mt-10 space-y-10">
        {groups.map((group) => {
          const groupRules = rules.filter((r) => r.group === group);
          if (!groupRules.length) return null;
          return (
            <div key={group}>
              <SectionTitle>{group}</SectionTitle>
              <ul className="mt-3 divide-y divide-rule-soft border-y border-rule">
                {groupRules.map((rule) => (
                  <li key={rule.id} className="flex flex-col justify-between gap-1 py-4 sm:flex-row sm:items-center sm:gap-8">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{rule.name}</p>
                      <p className="text-sm text-graphite">{rule.note}</p>
                    </div>
                    <p className="shrink-0 font-medium text-ink sm:text-right">{rule.formatted}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Budgets */}
      <section className="mt-16 border-t border-rule pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <SectionTitle>Budgets</SectionTitle>
            <p className="mt-1 max-w-[64ch] text-sm text-graphite">
              Limits on spending from {businessName}’s one Vault balance, not separate bank accounts. A period is a fixed window, such as 30 days, counted onchain.
            </p>
          </div>
          {isOwner ? <Button variant="secondary" onClick={() => setCreatingBudget(true)}>New budget</Button> : null}
        </div>

        {creatingBudget ? (
          <Overlay title="New budget" description="A cap on spending over a fixed period." onClose={() => { if (!busy) setCreatingBudget(false); }}>
            <form onSubmit={handleCreateBudget} className="space-y-4">
              {error ? <InlineError>{error}</InlineError> : null}
              <Field label="Name">
                {(a) => <input {...a} type="text" placeholder="Marketing" value={budgetName} onChange={(e) => setBudgetName(e.target.value)} className={controlClass} required />}
              </Field>
              <Field label="Cap ($)">
                {(a) => <input {...a} type="number" step="any" value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} className={controlClass} required />}
              </Field>
              <Field label="Period">
                {(a) => (
                  <select {...a} value={budgetPeriod} onChange={(e) => setBudgetPeriod(e.target.value)} className={controlClass}>
                    <option value={String(7 * 86400)}>7 days</option>
                    <option value={String(30 * 86400)}>30 days</option>
                    <option value={String(90 * 86400)}>90 days</option>
                  </select>
                )}
              </Field>
              <Overlay.Footer>
                <Button variant="secondary" disabled={busy} onClick={() => setCreatingBudget(false)}>Cancel</Button>
                <Button type="submit" busy={busy}>{busy ? "Creating…" : "Create the budget"}</Button>
              </Overlay.Footer>
            </form>
          </Overlay>
        ) : null}

        <ul className="mt-6 divide-y divide-rule-soft border-y border-rule">
          {budgets.map((b) => (
            <li key={b.id} className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr] sm:items-center">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  <span>{b.name}</span>
                  {b.isOperating ? <StatusPill tone="neutral">Default</StatusPill> : null}
                </p>
                <p className="text-sm text-graphite">{b.periodLengthLabel}</p>
              </div>
              <div><p className="text-sm text-graphite">Spent this period</p><p className="font-medium text-ink">{b.spent}</p></div>
              <div><p className="text-sm text-graphite">Cap</p><p className="font-medium text-ink">{b.cap}</p></div>
              <div><p className="text-sm text-graphite">Remaining</p><p className="font-medium text-ink">{b.remaining}</p></div>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
