"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";

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
      const provider = await findWalletFor(signer.address, wallets);
      if (!provider) throw new Error(wrongWalletMessage(signer.address));
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
      router.refresh();
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
        className="rounded-doc border border-red/50 px-3 py-1.5 text-xs text-red hover:bg-red-wash"
      >
        Cancel invoice…
      </button>

      {open ? (
        <Overlay
          label={{ id: "cancel-invoice-title" }}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="p-7">
            <h2 id="cancel-invoice-title" className="font-display text-2xl text-red">
              Cancel Invoice {invoiceNumber}
            </h2>
            <p className="mt-3 text-sm text-graphite">
              Cancelling marks this invoice cancelled on the Arc InvoiceLedger.
              Once cancelled, this fingerprint can <strong>never</strong> be paid by any Vault.
            </p>
            <p className="mt-3 text-xs text-graphite">
              Your wallet will ask for an EIP-712 Cancel signature, and then submit the cancel transaction to the ledger.
            </p>

            {error ? (
              <div role="alert" className="mt-4 rounded-doc border border-red/40 bg-red-wash p-3 text-xs text-red">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-doc border border-rule px-4 py-2 text-sm"
              >
                Keep Invoice
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleCancel}
                className="rounded-doc bg-red px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Cancelling..." : "Cancel on Ledger"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </>
  );
}
