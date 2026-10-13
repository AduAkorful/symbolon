"use client";

import { useState } from "react";

import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/StatusPill";
import { SentTransactionNotice, useSentTransaction } from "@/components/wallet/useSentTransaction";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { recordQueuedChange } from "@/lib/client/queued-actions";

type Prepared = { ok: true; state: string; to: string; data: string; loosening: boolean; eta?: string };

/**
 * One currency the Vault pays in, with the owner's switch (plan 05zj D, SYM-09). Turning a currency off tightens and applies at
 * once; turning one on loosens, so it is queued and waits the Vault's loosening delay like every other loosening change. The
 * transaction hash is kept (`useSentTransaction`), so a slow confirmation never sends it twice.
 */
export function CurrencyRow({
  businessId,
  token,
  signer,
  explorer,
  isOwner,
  canTurnOff,
  onChanged,
}: {
  businessId: string;
  token: { address: string; symbol: string; supported: boolean };
  signer: SignerPlan;
  explorer: string;
  isOwner: boolean;
  /** False for the only currency left: a Vault with none can't pay anything */
  canTurnOff: boolean;
  onChanged: () => void;
}) {
  const discover = useWalletProviders();
  const tx = useSentTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // a turn-on that was queued stays queued until it is applied: asking again would queue the same change twice
  const [queued, setQueued] = useState(false);
  const next = !token.supported;

  async function change() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const prep = await postJson<Prepared>(`/api/business/${businessId}/queued-changes`, {
        action: "prepare",
        spec: { kind: "setSupportedToken", args: [token.address, next] },
      });
      await tx.run({
        send: () => sendCall(signer, { to: prep.to, data: prep.data }, discover),
        record: (hash) => recordQueuedChange(businessId, hash),
        onDone: () => {
          if (prep.loosening) setQueued(true);
          setNote(
            prep.loosening
              ? `Queued. ${token.symbol} turns on after your Vault's waiting period; apply it under “Changes waiting” further down this page.`
              : `${token.symbol} is off.`,
          );
          onChanged();
        },
      });
    } catch (e) {
      setError(wasRejected(e) ? "You closed the wallet's request, so nothing was sent." : e instanceof Error ? e.message : "Couldn't change this currency.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-doc border border-rule px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-ink">{token.symbol}</span>
        <span className="text-graphite">{token.address.slice(0, 6)}…{token.address.slice(-4)}</span>
        <StatusPill tone={token.supported ? "ok" : "neutral"}>{token.supported ? "On" : "Off"}</StatusPill>
        {isOwner && (next || canTurnOff) ? (
          <Button variant="secondary" size="sm" busy={busy || tx.busy} disabled={tx.locked || (next && queued)} onClick={() => void change()}>
            {busy || tx.busy ? "Waiting…" : next && queued ? "Queued" : next ? `Turn on ${token.symbol}` : `Turn off ${token.symbol}`}
          </Button>
        ) : null}
      </div>
      <SentTransactionNotice tx={tx} explorer={explorer} />
      {note ? <p role="status" className="mt-2 text-graphite">{note}</p> : null}
      {error ? <p role="alert" className="mt-2 text-red">{error}</p> : null}
    </li>
  );
}
