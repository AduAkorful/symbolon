"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button, buttonClass } from "@/components/ui/button";
import { InlineError } from "@/components/ui/States";
import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import { refreshAfterChain } from "@/lib/client/refresh";

interface Props {
  fingerprint: string;
  invoiceNumber: string;
  signer: SignerPlan;
}

export function CancelInvoiceAction({ fingerprint, invoiceNumber, signer }: Props) {
  const router = useRouter();
  const discover = useWalletProviders();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    setError(null);
    setBusy(true);

    try {
      // 1. Prepare
      const prepRes = await fetch("/api/vendor/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", fingerprint }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error || "Failed to prepare cancel");

      // 2. Sign
      const signature = await signTypedData(signer, prepData.typedData, discover);

      // 3. Submit
      const subRes = await fetch("/api/vendor/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", fingerprint, signature }),
      });
      const subData = await subRes.json();
      if (!subRes.ok) throw new Error(subData.error || "Failed to submit cancel");

      // 4. Send ledger transaction
      if (signer.kind === "none") throw new Error(signer.reason);
      const wallets = await discover();
      const seen: string[] = [];
      const provider = await findWalletFor(signer.address, wallets, seen);
      if (!provider) throw new Error(wrongWalletMessage(signer.address, seen));
      await ensureChain(provider, signer.chain);

      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: signer.address,
            to: subData.to,
            data: subData.data,
          },
        ],
      })) as `0x${string}`;

      // 5. Record
      const recRes = await fetch("/api/vendor/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record", requestId: subData.requestId, txHash }),
      });
      const recData = await recRes.json();
      if (!recRes.ok) throw new Error(recData.error || "Failed to record cancellation");

      setOpen(false);
      refreshAfterChain(router);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={buttonClass({ variant: "danger", size: "sm" })}
      >
        Cancel this invoice…
      </button>

      {open ? (
        <Overlay
          title={`Cancel invoice ${invoiceNumber}`}
          description="Cancelling is recorded on the Arc ledger and can't be undone."
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <p className="text-graphite">
            Once cancelled, this invoice can <strong className="text-ink">never</strong> be paid by any Vault.
          </p>
          <p className="text-graphite">Your wallet will ask you to sign the cancellation, and then send it to the ledger.</p>

          {error ? <InlineError>{error}</InlineError> : null}

          <Overlay.Footer>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Keep invoice</Button>
            <Button variant="destructive" busy={busy} onClick={handleCancel}>{busy ? "Cancelling…" : "Cancel invoice"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </>
  );
}
