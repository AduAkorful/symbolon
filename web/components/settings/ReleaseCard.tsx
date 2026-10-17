"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TxLink } from "@/components/TxLink";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";
import { useSentHashes } from "@/components/wallet/useSentTransaction";
import type { ReleaseViewInfo } from "@/lib/server/release";
import { buttonClass } from "@/components/ui/button";
import { ReleaseNotesBody } from "./ReleaseNotesBody";
import { formatDateTime } from "@/lib/format";

interface ReleaseCardProps {
  businessId: string;
  release: ReleaseViewInfo | null;
  signer: SignerPlan;
  isOwner: boolean;
  onRefresh?: () => void;
  /** the explorer base, so a scheduled or applied upgrade links its transaction in full (SYM-03) */
  explorer?: string;
}

export function ReleaseCard({
  businessId,
  release,
  signer,
  isOwner,
  onRefresh,
  explorer,
}: ReleaseCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [stateDiffs, setStateDiffs] = useState<string[] | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const getProviders = useWalletProviders();
  const sent = useSentHashes();

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
    setSuccessTx(null);
    try {
      // A transaction that was already sent is only checked again, never sent a second time
      let txHash = sent.get("schedule");
      if (!txHash) {
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
        txHash = await sendWithWallet(providers, signer, {
          to: prep.to,
          data: prep.data,
        });
        sent.set("schedule", txHash);
      }

      const rec = await postRecord<{ ok: boolean; readyAt: number }>(
        `/api/business/${businessId}/settings`,
        {
          action: "record-schedule",
          txHash,
        },
      );
      sent.clear("schedule");

      if (rec.ok) {
        setSuccess(`Release ${latest.version} upgrade scheduled.`);
        setSuccessTx(txHash);
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
    setSuccessTx(null);
    try {
      let txHash = sent.get("cancel");
      if (!txHash) {
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
        txHash = await sendWithWallet(providers, signer, {
          to: prep.to,
          data: prep.data,
        });
        sent.set("cancel", txHash);
      }

      const rec = await postRecord<{ ok: boolean }>(
        `/api/business/${businessId}/settings`,
        {
          action: "record-cancel-upgrade",
          txHash,
        },
      );
      sent.clear("cancel");

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
    setSuccessTx(null);
    setStateDiffs(null);
    try {
      // The operation (the Vault's state read before the upgrade) is kept with the hash, so a second try compares against the same "before"
      let txHash = sent.get("apply");
      let operationId = sent.get("apply-op");
      if (!txHash || !operationId) {
        const prep = await postJson<{
          ok: boolean;
          to: string;
          data: string;
          operationId: string;
        }>(`/api/business/${businessId}/settings`, {
          action: "prepare-upgrade",
        });

        if (!prep.ok) throw new Error("Could not prepare upgrade.");
        if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

        const providers = await getProviders();
        txHash = await sendWithWallet(providers, signer, {
          to: prep.to,
          data: prep.data,
        });
        operationId = prep.operationId;
        sent.set("apply", txHash);
        sent.set("apply-op", operationId);
      }

      const rec = await postRecord<{
        ok: boolean;
        stateMatch: boolean;
        diffs: string[];
      }>(`/api/business/${businessId}/settings`, {
        action: "record-upgrade",
        txHash,
        operationId,
      });
      sent.clear("apply");
      sent.clear("apply-op");

      if (rec.ok) {
        if (rec.stateMatch) {
          setSuccess(`Vault upgraded to release ${latest.version}. Known payees, budgets, policy, roles and token balances matched.`);
          setSuccessTx(txHash);
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
    <div className="mt-4 rounded-doc border border-rule bg-paper-raised px-5 py-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <div>
          <span className="font-medium text-base">
            {state === "up-to-date" && `Release ${current.version ?? latest.version} (latest)`}
            {state === "available" && `Release ${latest.version} is available`}
            {state === "scheduled" && `Release ${latest.version} is scheduled`}
            {state === "ready" && `Release ${latest.version} is ready to apply`}
            {state === "revoked" && `Release ${latest.version} (revoked)`}
          </span>
          <span className="ml-3 font-mono text-sm text-graphite">
            · Current: {current.version ? `v${current.version}` : "unknown"}
          </span>
        </div>
        <span className="font-mono text-sm text-graphite">
          {state === "up-to-date" ? "Implementation" : `Release ${latest.version} implementation`}: {latest.implementation.slice(0, 6)}…{latest.implementation.slice(-4)}
          {current.implementation && state !== "up-to-date" ? ` · running ${current.implementation.slice(0, 6)}…${current.implementation.slice(-4)}` : ""}
        </span>
        <Link href="/business/settings/releases" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
          See every release
        </Link>
      </div>

      {state === "up-to-date" && (
        <div className="mt-4">
          <p className="text-graphite">
            Your Vault is running the latest published release. No upgrades are pending.
          </p>
          {release.installedBy && explorer && !successTx ? (
            <p className="mt-2 text-graphite">
              {release.installedBy.kind === "created" ? "Running this release since the Vault was created" : `Upgraded to release ${current.version ?? latest.version}`}
              {release.installedBy.at ? ` on ${formatDateTime(release.installedBy.at)}` : ""}.{" "}
              <TxLink href={`${explorer}/tx/${release.installedBy.txHash}`} label="View the upgrade transaction on the Arc explorer">View transaction</TxLink>
            </p>
          ) : null}
          {latest.notes && (
            <div className="mt-4 rounded border border-rule/50 bg-paper p-3 text-sm leading-relaxed text-graphite">
              <p className="mb-2 font-medium text-ink">What this release does</p>
              <ReleaseNotesBody notes={latest.notes} />
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
            <div className="rounded border border-rule/50 bg-paper p-3 text-sm leading-relaxed text-graphite">
              <p className="mb-2 font-medium text-ink">What this release does</p>
              {latest.notes ? <ReleaseNotesBody notes={latest.notes} /> : null}
            </div>
          ) : (
            <div className="rounded border border-warn/40 bg-warn-wash p-3 text-sm text-warn">
              Release notes cannot be verified against the onchain notes hash ({latest.notesHash}).
            </div>
          )}

          {isOwner && (
            <div className="pt-2">
              <button
                type="button"
                onClick={handleSchedule}
                disabled={busy}
                className={buttonClass({ size: "sm" })}
              >
                {busy ? "Scheduling..." : sent.get("schedule") ? "Check again" : `Schedule release ${latest.version}`}
              </button>
            </div>
          )}
        </div>
      )}

      {state === "scheduled" && !isDelayElapsed && (
        <div className="mt-4 space-y-3">
          <p className="text-graphite">
            Upgrade scheduled. You can apply it once the loosening delay passes:
            {release.scheduledTx && explorer && !successTx ? <>{" "}<TxLink href={`${explorer}/tx/${release.scheduledTx.txHash}`} label="View the schedule transaction on the Arc explorer">View transaction</TxLink></> : null}
          </p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-medium">{countdownStr}</span>
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
                className={buttonClass({ variant: "danger", size: "sm" })}
              >
                {busy ? "Cancelling..." : sent.get("cancel") ? "Check again" : "Cancel the schedule"}
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
          {release.scheduledTx && explorer && !successTx ? (
            <p className="text-sm text-graphite">
              Scheduled{release.scheduledTx.at ? ` on ${formatDateTime(release.scheduledTx.at)}` : ""}.{" "}
              <TxLink href={`${explorer}/tx/${release.scheduledTx.txHash}`} label="View the schedule transaction on the Arc explorer">View transaction</TxLink>
            </p>
          ) : null}
          <p className="text-xs text-graphite">
            Symbolon compares server-recorded snapshots of known payees, budgets, policy, roles and token balances.
            Missing reads or differences are reported; this check cannot enumerate unknown onchain records.
          </p>

          {isOwner && (
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleApply}
                disabled={busy}
                className={buttonClass({ size: "sm" })}
              >
                {busy ? "Applying upgrade..." : sent.get("apply") ? "Check again" : `Apply release ${latest.version}`}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                Cancel schedule
              </button>
            </div>
          )}
        </div>
      )}

      {state === "revoked" && (
        <div className="mt-4 rounded border border-red/50 bg-red-wash/40 p-3 text-sm text-red">
          Release {latest.version} was revoked by the Release Registry owner and cannot be applied.
        </div>
      )}

      {success && (
        <div className="mt-3 rounded border border-seal/50 bg-seal-wash/40 p-2.5 text-sm text-seal">
          {success}
          {successTx && explorer ? (
            <>
              {" "}
              <TxLink href={`${explorer}/tx/${successTx}`} label="View the transaction on the Arc explorer">View transaction</TxLink>
            </>
          ) : null}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded border border-red/50 bg-red-wash/40 p-2.5 text-sm text-red">
          {error}
        </div>
      )}

      {stateDiffs && stateDiffs.length > 0 && (
        <div className="mt-3 rounded border border-red bg-red-wash/60 p-3 text-sm text-red">
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
