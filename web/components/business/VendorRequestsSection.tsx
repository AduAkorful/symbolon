"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { useSentHashes } from "@/components/wallet/useSentTransaction";
import { postRecord } from "@/lib/client/api";
import type { PayoutChangeRequestItem } from "@/lib/server/payout-change";
import { formatDay, formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";
import { useConfirm } from "@/components/useConfirm";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { SectionTitle } from "@/components/ui/Type";
import { refreshAfterChain } from "@/lib/client/refresh";

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
  const sent = useSentHashes();

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const nowSecs = Math.floor(Date.now() / 1000);
  const hasActiveCooldown = !!pendingActiveAt && pendingActiveAt > nowSecs;

  async function handleConfirm(requestId: string) {
    if (!isOwner) return;
    setError(null);
    setBusy(true);

    try {
      // 1. Prepare (not when the transaction was already sent: it is only checked again)
      let prepData: { to?: string; data?: string } = {};
      if (!sent.get(`confirm:${requestId}`)) {
        const prepRes = await fetch(`/api/business/${businessId}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "prepare_confirm", requestId }),
        });
        prepData = await prepRes.json();
        if (!prepRes.ok) throw new Error((prepData as { error?: string }).error || "Failed to prepare confirmation");
      }

      // 2. Send transaction with owner wallet (a hash kept from an earlier try is checked again, never sent twice)
      const key = `confirm:${requestId}`;
      let txHash = sent.get(key) as `0x${string}` | undefined;
      if (!txHash) {
        if (signer.kind === "none") throw new Error(signer.reason);
        const wallets = await discover();
        const seen: string[] = [];
        const provider = await findWalletFor(signer.address, wallets, seen);
        if (!provider) throw new Error(wrongWalletMessage(signer.address, seen));
        await ensureChain(provider, signer.chain);

        txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: signer.address,
              to: prepData.to,
              data: prepData.data,
            },
          ],
        })) as `0x${string}`;
        sent.set(key, txHash);
      }

      // 3. Record
      await postRecord(`/api/business/${businessId}/requests`, { action: "record_confirm", requestId, txHash });
      sent.clear(key);

      refreshAfterChain(router);
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
      let prepData: { to?: string; data?: string } = {};
      if (!sent.get(`cancel:${requestId}`)) {
        const prepRes = await fetch(`/api/business/${businessId}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "prepare_cancel", requestId }),
        });
        prepData = await prepRes.json();
        if (!prepRes.ok) throw new Error((prepData as { error?: string }).error || "Failed to prepare cancel");
      }

      const key = `cancel:${requestId}`;
      let txHash = sent.get(key) as `0x${string}` | undefined;
      if (!txHash) {
        if (signer.kind === "none") throw new Error(signer.reason);
        const wallets = await discover();
        const seen: string[] = [];
        const provider = await findWalletFor(signer.address, wallets, seen);
        if (!provider) throw new Error(wrongWalletMessage(signer.address, seen));
        await ensureChain(provider, signer.chain);

        txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: signer.address,
              to: prepData.to,
              data: prepData.data,
            },
          ],
        })) as `0x${string}`;
        sent.set(key, txHash);
      }

      await postRecord(`/api/business/${businessId}/requests`, { action: "record_cancel", requestId, txHash });
      sent.clear(key);

      refreshAfterChain(router);
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
      refreshAfterChain(router);
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
          actions={isOwner && requests[0] ? <Button variant="danger" size="sm" disabled={busy} onClick={() => handleCancelPending(requests[0]!.id)}>{requests[0] && sent.get(`cancel:${requests[0].id}`) ? "Check again" : "Cancel the change in the Vault"}</Button> : undefined}
        >
          <p>Payout is changing to</p>
          <Address value={pendingPayout!} full copy className="text-ink" />
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
                  <Button busy={busy} onClick={() => handleConfirm(req.id)}>{busy ? "Confirming…" : sent.get(`confirm:${req.id}`) ? "Check again" : "Confirm in the Vault"}</Button>
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
