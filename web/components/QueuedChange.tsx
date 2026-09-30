"use client";

import { useEffect, useState } from "react";
import { TxLink } from "@/components/TxLink";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";

export interface QueuedChangeRow {
  id: string;
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
      if (res.ok) {
        const data = await res.json();
        setChanges(data.changes ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChanges();
  }, [businessId]);

  async function handleApply(change: QueuedChangeRow) {
    if (!change.calldata || signer.kind !== "wallet") return;
    setBusyId(change.id);
    setError(null);
    try {
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: signer.address, // target Vault handled via call
        data: change.calldata,
      });

      await postJson(`/api/business/${businessId}/queued-changes`, {
        action: "record",
        txHash,
      });

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

      await postJson(`/api/business/${businessId}/queued-changes`, {
        action: "record",
        txHash,
      });

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
    return null;
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
                    <span>Ready at {new Date(change.eta).toLocaleString()}</span>
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
