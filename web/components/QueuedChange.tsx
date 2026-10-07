"use client";

import { useEffect, useState } from "react";
import { TxLink } from "@/components/TxLink";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { applyQueuedChange, recordQueuedChange } from "@/lib/client/queued-actions";
import { formatDateTime } from "@/lib/format";

export interface QueuedChangeRow {
  id: string;
  to: string | null;
  kind: string;
  changeId: string;
  selector: string;
  calldata?: string | null;
  summary: { title?: string; details?: Record<string, unknown> };
  eta: string | Date;
  status: "queued" | "applied" | "cancelled";
  queueTx?: string | null;
  appliedTx?: string | null;
  cancelledTx?: string | null;
  createdAt?: string | Date;
}

interface QueuedChangeProps {
  businessId: string;
  signer: SignerPlan;
  explorer?: string;
  onRefresh?: () => void;
}

export function QueuedChangeList({
  businessId,
  signer,
  explorer = "https://explorer.testnet.arc.io",
  onRefresh,
}: QueuedChangeProps) {
  const [changes, setChanges] = useState<QueuedChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function loadChanges() {
    try {
      const res = await fetch(`/api/business/${businessId}/queued-changes`);
      if (!res.ok) throw new Error("Can't load queued changes. Try again.");
      if (res.ok) {
        const data = await res.json();
        setChanges(data.changes ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Can't load queued changes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChanges();
  }, [businessId]);

  async function handleApply(change: QueuedChangeRow) {
    if (!change.calldata || !change.to || signer.kind !== "wallet") return;
    setBusyId(change.id);
    setError(null);
    try {
      const providers = await getProviders();
      await applyQueuedChange(businessId, change, call => sendWithWallet(providers, signer, call));

      await loadChanges();
      onRefresh?.();
    } catch (e: any) {
      setError(e.message || "Failed to apply queued change");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(change: QueuedChangeRow) {
    if (signer.kind !== "wallet") return;
    setBusyId(change.id);
    setError(null);
    try {
      const prep = await postJson<{ to: string; data: string }>(
        `/api/business/${businessId}/queued-changes`,
        {
          action: "prepare-cancel",
          changeId: change.changeId,
        },
      );

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      await recordQueuedChange(businessId, txHash);

      await loadChanges();
      onRefresh?.();
    } catch (e: any) {
      setError(e.message || "Failed to cancel queued change");
    } finally {
      setBusyId(null);
    }
  }

  const activeChanges = changes.filter((c) => c.status === "queued");

  if (loading) {
    return <div className="p-4 text-xs text-graphite">Loading queued changes…</div>;
  }

  if (activeChanges.length === 0) {
    return error ? <p role="alert" className="p-4 text-xs text-red">{error}</p> : null;
  }

  return (
    <div className="space-y-4 rounded border border-rule bg-paper-raised p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-medium text-ink">
          Queued loosening changes ({activeChanges.length})
        </h3>
        <span className="text-[11px] text-graphite">Delayed by Vault policy</span>
      </div>

      {error ? (
        <div className="rounded bg-red-wash p-2 text-xs text-red">{error}</div>
      ) : null}

      <div className="space-y-3">
        {activeChanges.map((change) => {
          const etaTime = new Date(change.eta).getTime();
          const isReady = Date.now() >= etaTime;
          const isBusy = busyId === change.id;

          return (
            <div
              key={change.id}
              className="flex flex-col gap-2 rounded border border-rule-soft bg-paper p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium text-ink">
                  {change.summary.title || "Vault policy change"}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-graphite">
                  ID: {change.changeId.slice(0, 10)}…{change.changeId.slice(-8)}
                  {" · "}
                  {isReady ? (
                    <span className="font-medium text-forest">Ready to apply</span>
                  ) : (
                    <span>Ready at {formatDateTime(new Date(change.eta))}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {change.queueTx ? (
                  <TxLink href={`${explorer}/tx/${change.queueTx}`} label="Queued transaction">
                    Queued tx
                  </TxLink>
                ) : null}

                {isReady && change.calldata ? (
                  <button
                    type="button"
                    disabled={isBusy || signer.kind !== "wallet"}
                    onClick={() => handleApply(change)}
                    className="rounded bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
                  >
                    {isBusy ? "Applying…" : "Apply now"}
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={isBusy || signer.kind !== "wallet"}
                  onClick={() => handleCancel(change)}
                  className="rounded border border-rule px-2 py-1 text-[11px] text-graphite hover:text-ink disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface SingleQueuedChangeProps {
  businessId: string;
  changeId: string;
  kind?: string;
  state: "ready" | "will-queue" | "apply-now" | "already-queued";
  eta?: string | Date | null;
  looseningDelaySeconds?: number;
  summary?: { title?: string; details?: Record<string, unknown> };
  signer: SignerPlan;
  onApplied?: () => void;
  onCancelled?: () => void;
  explorer?: string;
}

export function QueuedChange({
  businessId,
  changeId,
  state,
  eta,
  looseningDelaySeconds,
  summary,
  signer,
  onApplied,
  onCancelled,
  explorer = "https://explorer.testnet.arc.io",
}: SingleQueuedChangeProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  const isReady = state === "ready" || (eta ? Date.now() >= new Date(eta).getTime() : false);

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      const prep = await postJson<{ ok: boolean; to: string; data: string }>(
        `/api/business/${businessId}/queued-changes`,
        {
          action: "prepare-cancel",
          changeId,
        },
      );
      if (!prep.ok) throw new Error("Could not prepare cancellation.");
      if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      const rec = await recordQueuedChange(businessId, txHash);
      if (rec.ok) onCancelled?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel change.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-amber-300 bg-paper p-4 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-ink">{summary?.title || "Queued change"}</div>
          <div className="mt-0.5 text-graphite">
            {isReady ? (
              <span className="font-medium text-forest">Ready to apply</span>
            ) : eta ? (
              <span>Ready at {formatDateTime(new Date(eta))}</span>
            ) : looseningDelaySeconds !== undefined ? (
              <span>Waits {Math.round(looseningDelaySeconds / 3600)}h delay</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || signer.kind !== "wallet"}
            onClick={handleCancel}
            className="rounded border border-rule px-2.5 py-1 text-graphite hover:text-ink disabled:opacity-50"
          >
            {busy ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-red">{error}</p>}
    </div>
  );
}

