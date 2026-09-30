"use client";

import { useEffect, useState } from "react";
import { TxLink } from "@/components/TxLink";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { ReleaseViewInfo, VaultStateSnapshot } from "@/lib/server/release";

interface ReleaseCardProps {
  businessId: string;
  release: ReleaseViewInfo | null;
  signer: SignerPlan;
  isOwner: boolean;
  onRefresh?: () => void;
}

export function ReleaseCard({
  businessId,
  release,
  signer,
  isOwner,
  onRefresh,
}: ReleaseCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stateDiffs, setStateDiffs] = useState<string[] | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const getProviders = useWalletProviders();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!release) {
    return (
      <div className="mt-4 rounded-doc border border-rule p-4 text-sm text-graphite">
        Vault release details could not be loaded.
      </div>
    );
  }

  const { state, current, latest, scheduled, looseningDelay } = release;
  const readyAtMs = scheduled.readyAt * 1000;
  const leftSec = Math.max(0, Math.floor((readyAtMs - now) / 1000));
  const isDelayElapsed = scheduled.readyAt > 0 && leftSec === 0;

  const hours = Math.floor(leftSec / 3600);
  const mins = Math.floor((leftSec % 3600) / 60);
  const secs = leftSec % 60;
  const countdownStr = `${hours}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;

  const totalDelaySec = looseningDelay || 24 * 3600;
  const fraction = scheduled.readyAt > 0
    ? Math.min(1, Math.max(0, 1 - leftSec / totalDelaySec))
    : 0;

  async function handleSchedule() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
      }>(`/api/business/${businessId}/settings`, {
        action: "prepare-schedule",
      });

      if (!prep.ok) throw new Error("Could not prepare upgrade schedule.");
      if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      const rec = await postJson<{ ok: boolean; readyAt: number }>(
        `/api/business/${businessId}/settings`,
        {
          action: "record-schedule",
          txHash,
        },
      );

      if (rec.ok) {
        setSuccess(`Release ${latest.version} upgrade scheduled successfully.`);
        onRefresh?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to schedule upgrade.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
      }>(`/api/business/${businessId}/settings`, {
        action: "prepare-cancel-upgrade",
      });

      if (!prep.ok) throw new Error("Could not prepare cancel upgrade.");
      if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      const rec = await postJson<{ ok: boolean }>(
        `/api/business/${businessId}/settings`,
        {
          action: "record-cancel-upgrade",
          txHash,
        },
      );

      if (rec.ok) {
        setSuccess("Upgrade schedule cancelled.");
        onRefresh?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel upgrade.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setStateDiffs(null);
    try {
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
        stateSnapshotBefore: VaultStateSnapshot;
      }>(`/api/business/${businessId}/settings`, {
        action: "prepare-upgrade",
      });

      if (!prep.ok) throw new Error("Could not prepare upgrade.");
      if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      const rec = await postJson<{
        ok: boolean;
        stateMatch: boolean;
        diffs: string[];
      }>(`/api/business/${businessId}/settings`, {
        action: "record-upgrade",
        txHash,
        stateSnapshotBefore: prep.stateSnapshotBefore,
      });

      if (rec.ok) {
        if (rec.stateMatch) {
          setSuccess(`Vault successfully upgraded to Release ${latest.version}. All state verified identical.`);
        } else {
          setStateDiffs(rec.diffs);
          setError("Vault upgraded, but state differences were detected.");
        }
        onRefresh?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply upgrade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-doc border border-rule bg-paper-raised p-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <div>
          <span className="font-medium text-base">
            {state === "up-to-date" && `Release ${current.version ?? latest.version} (latest)`}
            {state === "available" && `Release ${latest.version} is available`}
            {state === "scheduled" && `Release ${latest.version} is scheduled`}
            {state === "ready" && `Release ${latest.version} is ready to apply`}
            {state === "revoked" && `Release ${latest.version} (revoked)`}
          </span>
          <span className="ml-3 font-mono text-xs text-graphite">
            Current: {current.version ? `v${current.version}` : "unknown"}
          </span>
        </div>
        <span className="font-mono text-xs text-graphite">
          Implementation: {latest.implementation.slice(0, 6)}…{latest.implementation.slice(-4)}
        </span>
      </div>

      {state === "up-to-date" && (
        <div className="mt-4">
          <p className="text-graphite">
            Your Vault is running the latest published release. No upgrades are pending.
          </p>
          {latest.notes && (
            <div className="mt-4 rounded border border-rule/50 bg-paper p-3 text-xs leading-relaxed text-graphite whitespace-pre-line">
              <p className="font-medium text-ink mb-1">Release notes (verified):</p>
              {latest.notes}
            </div>
          )}
        </div>
      )}

      {state === "available" && (
        <div className="mt-4 space-y-3">
          <p className="text-graphite">
            A new release has been published to the Symbolon Release Registry. Upgrades are controlled
            entirely by you. Scheduling starts your {Math.round(totalDelaySec / 3600)}-hour delay.
            Payments keep running on release {current.version ?? 1} until you apply it.
          </p>

          {latest.notesVerified ? (
            <div className="rounded border border-rule/50 bg-paper p-3 text-xs leading-relaxed text-graphite whitespace-pre-line">
              <p className="font-medium text-ink mb-1">Release notes (verified hash):</p>
              {latest.notes}
            </div>
          ) : (
            <div className="rounded border border-amber-300 bg-amber-50/50 p-3 text-xs text-amber-900">
              Release notes cannot be verified against the onchain notes hash ({latest.notesHash}).
            </div>
          )}

          {isOwner && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleSchedule}
                disabled={busy}
                className="rounded-doc bg-ink px-4 py-2 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Scheduling..." : `Schedule release ${latest.version}`}
              </button>
            </div>
          )}
        </div>
      )}

      {state === "scheduled" && !isDelayElapsed && (
        <div className="mt-4 space-y-3">
          <p className="text-graphite">
            Upgrade scheduled. You can apply it once the loosening delay passes:
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-medium tabular-nums">{countdownStr}</span>
            <span className="text-xs text-graphite">remaining</span>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-rule-soft"
            role="progressbar"
            aria-label="Upgrade delay elapsed"
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-seal transition-all duration-500"
              style={{ width: `${Math.max(2, fraction * 100)}%` }}
            />
          </div>

          <p className="text-xs text-graphite">
            Payments keep running on release {current.version ?? 1} until applied. You can cancel at any time.
          </p>

          {isOwner && (
            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="rounded-doc border border-red/60 px-3 py-1.5 text-xs text-red hover:bg-red-wash disabled:opacity-50"
              >
                {busy ? "Cancelling..." : "Cancel the schedule"}
              </button>
            </div>
          )}
        </div>
      )}

      {(state === "ready" || (state === "scheduled" && isDelayElapsed)) && (
        <div className="mt-4 space-y-3">
          <p className="text-graphite font-medium text-seal">
            The loosening delay has passed. Release {latest.version} is ready to apply.
          </p>
          <p className="text-xs text-graphite">
            Symbolon will take a state snapshot before and after applying the upgrade to guarantee
            that payees, budgets, policy and balances remain intact.
          </p>

          {isOwner && (
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleApply}
                disabled={busy}
                className="rounded-doc bg-ink px-4 py-2 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Applying upgrade..." : `Apply release ${latest.version}`}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="rounded-doc border border-rule px-3 py-1.5 text-xs hover:border-ink disabled:opacity-50"
              >
                Cancel schedule
              </button>
            </div>
          )}
        </div>
      )}

      {state === "revoked" && (
        <div className="mt-4 rounded border border-red/50 bg-red-wash/40 p-3 text-xs text-red">
          Release {latest.version} was revoked by the Release Registry owner and cannot be applied.
        </div>
      )}

      {success && (
        <div className="mt-3 rounded border border-seal/50 bg-seal-wash/40 p-2.5 text-xs text-seal">
          {success}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-red/50 bg-red-wash/40 p-2.5 text-xs text-red">
          {error}
        </div>
      )}

      {stateDiffs && stateDiffs.length > 0 && (
        <div className="mt-3 rounded border border-red bg-red-wash/60 p-3 text-xs text-red">
          <p className="font-medium mb-1">State differs after the upgrade:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {stateDiffs.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
