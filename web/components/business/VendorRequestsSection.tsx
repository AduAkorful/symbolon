"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import type { PayoutChangeRequestItem } from "@/lib/server/payout-change";
import { formatDay, formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";
import { useConfirm } from "@/components/useConfirm";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { SectionTitle } from "@/components/ui/Type";

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
  const [ask, confirmDialog] = useConfirm();
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
    if (!(await ask({ title: "Cancel this payout change?", body: "The pending change is cancelled in the Vault and the vendor’s current payout address stays in place.", confirmLabel: "Cancel the change", destructive: true }))) return;
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
    if (!(await ask({ title: "Reject this payout change?", body: "The vendor’s request is rejected and their current payout address stays in place. They can ask again.", confirmLabel: "Reject the request", destructive: true }))) return;
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
    <section className="mt-10 border-t border-rule pt-8">
      {confirmDialog}
      <SectionTitle>Payout change requests</SectionTitle>
      <p className="mt-1 max-w-[64ch] text-sm text-graphite">
        When a vendor signs a change to their payout address, the Vault’s owner confirms it onchain. A cooldown protects your business before the new address takes effect.
      </p>

      {error ? <InlineError className="mt-4">{error}</InlineError> : null}

      {hasActiveCooldown ? (
        <Callout
          tone="info"
          title="Cooldown in progress"
          className="mt-4"
          actions={isOwner && requests[0] ? <Button variant="danger" size="sm" disabled={busy} onClick={() => handleCancelPending(requests[0]!.id)}>Cancel the change in the Vault</Button> : undefined}
        >
          <p className="flex flex-wrap items-baseline gap-x-2">Payout is changing to <Address value={pendingPayout!} /></p>
          <p className="mt-1 text-graphite">Takes effect {formatDateTime(new Date(pendingActiveAt! * 1000))}</p>
        </Callout>
      ) : null}

      {pendingRequests.length > 0 ? (
        <div className="mt-4 space-y-4">
          {pendingRequests.map((req) => (
            <div key={req.id} className="rounded-doc border border-rule px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusPill tone="warn">Waiting for the owner</StatusPill>
                <span className="text-sm text-graphite">{formatDay(new Date(req.createdAt))}</span>
              </div>

              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-graphite">New payout address</p>
                  <Address value={req.newPayout} full className="font-medium text-ink" />
                </div>
                <div>
                  <p className="text-graphite">Domain and nonce</p>
                  <p>Domain {req.payoutDomain} · Nonce {req.nonce}</p>
                </div>
              </div>

              <p className="mt-3 text-sm text-graphite">Payable at the new address only after your Vault’s cooldown has passed.</p>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-rule-soft pt-4">
                {isApprover || isOwner ? <Button variant="secondary" disabled={busy} onClick={() => handleReject(req.id)}>Reject</Button> : null}
                {isOwner ? (
                  <Button busy={busy} onClick={() => handleConfirm(req.id)}>{busy ? "Confirming…" : "Confirm in the Vault"}</Button>
                ) : (
                  <span className="text-sm text-graphite">Only the owner can confirm this.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : !hasActiveCooldown ? (
        <p className="mt-3 text-sm text-graphite">No payout change is waiting for this vendor.</p>
      ) : null}
    </section>
  );
}
