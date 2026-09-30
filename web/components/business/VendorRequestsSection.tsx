"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import type { PayoutChangeRequestItem } from "@/lib/server/payout-change";

interface Props {
  businessId: string;
  seal: string;
  isOwner: boolean;
  isApprover: boolean;
  requests: PayoutChangeRequestItem[];
  pendingPayout?: string | null;
  pendingActiveAt?: number;
  signer: SignerPlan;
}

export function VendorRequestsSection({
  businessId,
  seal,
  isOwner,
  isApprover,
  requests,
  pendingPayout,
  pendingActiveAt,
  signer,
}: Props) {
  const router = useRouter();
  const discover = useWalletProviders();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const nowSecs = Math.floor(Date.now() / 1000);
  const hasActiveCooldown = !!pendingActiveAt && pendingActiveAt > nowSecs;

  async function handleConfirm(requestId: string) {
    if (!isOwner) return;
    setError(null);
    setBusy(true);

    try {
      // 1. Prepare
      const prepRes = await fetch(`/api/business/${businessId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_confirm", requestId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare confirmation");

      // 2. Send transaction with owner wallet
      if (signer.kind === "none") throw new Error(signer.reason);
      const wallets = await discover();
      const provider = await findWalletFor(signer.address, wallets);
      if (!provider) throw new Error(wrongWalletMessage(signer.address));
      await ensureChain(provider, signer.chain);

      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: signer.address,
            to: prepData.to,
            data: prepData.data,
          },
        ],
      })) as `0x${string}`;

      // 3. Record
      const recRes = await fetch(`/api/business/${businessId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_confirm", requestId, txHash }),
      });
      const recData = await recRes.json();
      if (!recRes.ok) throw new Error(recData.error || "Failed to record confirmation");

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelPending(requestId: string) {
    if (!isOwner) return;
    if (!confirm("Cancel this pending payout change on the Vault?")) return;
    setError(null);
    setBusy(true);

    try {
      const prepRes = await fetch(`/api/business/${businessId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_cancel", requestId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare cancel");

      if (signer.kind === "none") throw new Error(signer.reason);
      const wallets = await discover();
      const provider = await findWalletFor(signer.address, wallets);
      if (!provider) throw new Error(wrongWalletMessage(signer.address));
      await ensureChain(provider, signer.chain);

      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: signer.address,
            to: prepData.to,
            data: prepData.data,
          },
        ],
      })) as `0x${string}`;

      const recRes = await fetch(`/api/business/${businessId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_cancel", requestId, txHash }),
      });
      const recData = await recRes.json();
      if (!recRes.ok) throw new Error(recData.error || "Failed to record cancel");

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(requestId: string) {
    if (!confirm("Reject this payout change request?")) return;
    setError(null);
    setBusy(true);

    try {
      const res = await fetch(`/api/business/${businessId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", requestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject request");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="font-display text-2xl">Payout change requests</h2>
      <p className="mt-1 text-xs text-graphite">
        When a vendor signs a change to their payout address, it must be confirmed onchain by the Vault owner.
        A cooldown protects your business before the new address takes effect.
      </p>

      {error ? (
        <div role="alert" className="mt-4 rounded-doc border border-red/40 bg-red-wash p-3 text-xs text-red">
          {error}
        </div>
      ) : null}

      {/* Active cooldown banner */}
      {hasActiveCooldown ? (
        <div className="mt-4 rounded-doc border border-seal/50 bg-seal/5 p-4 text-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-seal font-medium">
                Cooldown in progress
              </span>
              <p className="mt-1 text-xs text-ink">
                Payout changing to <span className="font-mono">{pendingPayout}</span>
              </p>
              <p className="mt-0.5 text-xs text-graphite">
                Active from {new Date(pendingActiveAt! * 1000).toLocaleString()}
              </p>
            </div>
            {isOwner && requests[0] ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => handleCancelPending(requests[0]!.id)}
                className="rounded-doc border border-red/50 px-3 py-1.5 text-xs text-red hover:bg-red-wash disabled:opacity-40 self-start sm:self-auto"
              >
                Cancel change on Vault
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Pending requests */}
      {pendingRequests.length > 0 ? (
        <div className="mt-4 space-y-4">
          {pendingRequests.map((req) => (
            <div key={req.id} className="rounded-doc border border-rule bg-paper p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono uppercase tracking-wider text-seal font-medium">
                  Pending Owner Confirmation
                </span>
                <span className="text-graphite">{new Date(req.createdAt).toLocaleDateString()}</span>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div>
                  <span className="text-graphite block">New payout address:</span>
                  <span className="font-mono break-all font-medium text-ink">{req.newPayout}</span>
                </div>
                <div>
                  <span className="text-graphite block">Domain / Nonce:</span>
                  <span>Domain {req.payoutDomain} · Nonce {req.nonce}</span>
                </div>
              </div>

              <p className="mt-2 text-graphite">
                Payable at the new address after your Vault cooldown clears, and never before.
              </p>

              <div className="mt-4 flex gap-3 pt-3 border-t border-rule/60 justify-end">
                {isApprover || isOwner ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReject(req.id)}
                    className="rounded-doc border border-rule px-3 py-1.5 hover:border-ink disabled:opacity-40"
                  >
                    Reject
                  </button>
                ) : null}
                {isOwner ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleConfirm(req.id)}
                    className="rounded-doc bg-ink px-4 py-1.5 font-medium text-paper hover:opacity-90 disabled:opacity-40"
                  >
                    {busy ? "Confirming..." : "Confirm on Vault"}
                  </button>
                ) : (
                  <span className="text-graphite italic self-center">Owner confirmation required</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : !hasActiveCooldown ? (
        <p className="mt-3 text-xs text-graphite">No pending payout change requests for this vendor.</p>
      ) : null}
    </section>
  );
}
