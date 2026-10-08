"use client";

import { useState } from "react";
import { isLooseningTerms } from "@/lib/server/loosening";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { moneyDraft, moneyInput } from "@/lib/money-draft";
import { duration } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/Field";




interface PayeeTermsEditorProps {
  businessId: string;
  seal: string;
  currentTerms: {
    budget: string;
    requirePo: boolean;
    requireDelivery: boolean;
    monthlyCap: string; // raw bigint string
  };
  budgets: { id: string; name: string }[];
  signer: SignerPlan;
  looseningDelaySeconds: number;
  accountingDecimals: number;
}

export function PayeeTermsEditor({
  businessId,
  seal,
  currentTerms,
  budgets,
  signer,
  looseningDelaySeconds,
  accountingDecimals,
}: PayeeTermsEditorProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draftBudget, setDraftBudget] = useState(currentTerms.budget);
  const [draftRequirePo, setDraftRequirePo] = useState(currentTerms.requirePo);
  const [draftRequireDelivery, setDraftRequireDelivery] = useState(currentTerms.requireDelivery);
  const [draftMonthlyCapUsd, setDraftMonthlyCapUsd] = useState(
    moneyInput(currentTerms.monthlyCap, accountingDecimals),
  );

  const getProviders = useWalletProviders();

  const currentCapRaw = BigInt(currentTerms.monthlyCap);
  const parsedCap = moneyDraft(draftMonthlyCapUsd, accountingDecimals);
  const draftCapRaw = parsedCap.raw ?? currentCapRaw;

  const isLooser = isLooseningTerms(
    {
      budget: currentTerms.budget,
      requirePo: currentTerms.requirePo,
      requireDelivery: currentTerms.requireDelivery,
      monthlyCap: currentCapRaw,
    },
    {
      budget: draftBudget,
      requirePo: draftRequirePo,
      requireDelivery: draftRequireDelivery,
      monthlyCap: draftCapRaw,
    },
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      setError("Connect the owner’s wallet to update the terms.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Preparing payee terms transaction...");

    try {
      if (parsedCap.raw === undefined) throw new Error(parsedCap.error);
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
        state: string;
        isLooser: boolean;
      }>(`/api/business/${businessId}/payee-terms`, {
        action: "prepare",
        seal,
        terms: {
          budget: draftBudget,
          requirePo: draftRequirePo,
          requireDelivery: draftRequireDelivery,
          monthlyCap: draftCapRaw.toString(),
        },
      });

      setStatus("Please confirm transaction in your wallet...");
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      setStatus("Recording terms update...");
      await postJson(`/api/business/${businessId}/payee-terms`, {
        action: "record",
        seal,
        txHash,
      });

      setStatus("Payee terms successfully updated.");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Failed to update payee terms.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-4">
        <button
          onClick={() => setEditing(true)}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Edit payee terms
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="mt-4 rounded-doc border border-ink/20 bg-paper-raised p-4 text-sm">
      <h3 className="font-display text-base">Edit Payee Terms</h3>
      <p className="mt-1 text-xs text-graphite">
        Making terms stricter applies immediately. Making terms looser waits for the Vault’s loosening delay.
      </p>

      {status ? (
        <p className="mt-3 rounded border border-seal/30 bg-seal-wash/40 p-2 text-xs">{status}</p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded border border-red/40 bg-red-wash p-2 text-xs text-red">{error}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="termsBudget" className="block text-xs font-medium text-graphite">
            Budget
          </label>
          <select
            id="termsBudget"
            value={draftBudget}
            onChange={(e) => setDraftBudget(e.target.value)}
            className={controlClass}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="termsMonthlyCap" className="block text-xs font-medium text-graphite">
            Monthly cap ($)
          </label>
          <input
            id="termsMonthlyCap"
            type="number"
            step="any"
            value={draftMonthlyCapUsd}
            onChange={(e) => setDraftMonthlyCapUsd(e.target.value)}
            className={controlClass}
            required
          />
        </div>

        <div className="flex items-center gap-4 pt-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={draftRequirePo}
              onChange={(e) => setDraftRequirePo(e.target.checked)}
              className="rounded border-rule text-ink focus:ring-0"
            />
            Require purchase order
          </label>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={draftRequireDelivery}
              onChange={(e) => setDraftRequireDelivery(e.target.checked)}
              className="rounded border-rule text-ink focus:ring-0"
            />
            Require delivery confirmation
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
        <p className="text-xs">
          {isLooser ? (
            <span className="text-warn font-medium">
              Looser terms: will be queued for {duration(BigInt(looseningDelaySeconds))}.
            </span>
          ) : (
            <span className="text-ok font-medium">
              Stricter terms: applies immediately upon signature.
            </span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={buttonClass({ size: "sm" })}
          >
            {busy ? "Saving..." : isLooser ? "Queue update" : "Apply now"}
          </button>
        </div>
      </div>
    </form>
  );
}
