"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import type { Hex } from "viem";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/Field";
import { postJson, postRecord } from "@/lib/client/api";
import { refreshAfterChain } from "@/lib/client/refresh";
import { SentTransactionNotice, useSentTransaction, type SentTransaction } from "@/components/wallet/useSentTransaction";

type Step = "idle" | "signing" | "recording" | "done" | "error";

async function post(url: string, body: unknown) {
  return postJson<Record<string, any>>(url, body);
}

/** Confirm or reject the delivery of an invoice. Shown on the invoice detail page when the Vault requires delivery. */
export function DeliveryActions({
  businessId,
  fingerprint,
  /** "confirmed" | "rejected" — if set the action was already taken; show read-only */
  currentState,
  currentReason,
  /** The user's current wallet address, from the session (server-rendered) */
  userWallet,
  explorer = "https://explorer.testnet.arc.io",
}: {
  businessId: string;
  fingerprint: string;
  currentState?: string | null;
  currentReason?: string | null;
  userWallet?: string | null;
  explorer?: string;
}) {
  const { wallets } = useWallets();
  const router = useRouter();
  const tx = useSentTransaction();
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<string | null>(currentState ?? null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(currentReason ?? null);

  if (state === "confirmed") {
    return (
      <div id={`delivery-${fingerprint.slice(2, 10)}`} className="rounded-doc border border-rule p-4">
        <p className="text-sm font-medium text-seal">✓ Delivery confirmed</p>
        <p className="mt-1 text-xs text-graphite">
          This invoice can proceed to the approval and payment steps.
        </p>
      </div>
    );
  }

  if (state === "rejected") {
    return (
      <div id={`delivery-${fingerprint.slice(2, 10)}`} className="rounded-doc border border-rule p-4">
        <p className="text-sm font-medium text-red">✕ Delivery rejected</p>
        {rejectionReason ? (
          <p className="mt-1 text-sm text-graphite">{rejectionReason}</p>
        ) : null}
        <p className="mt-2 text-xs text-graphite">
          Confirm delivery to release this invoice for payment.
        </p>
        <div className="mt-3">
          <ConfirmButton
            businessId={businessId}
            fingerprint={fingerprint}
            wallets={wallets}
            onDone={() => { setState("confirmed"); refreshAfterChain(router); }}
            setStep={setStep}
            setMsg={setMsg}
            step={step}
            tx={tx}
          />
        </div>
        {msg ? <p className={`mt-2 text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p> : null}
        <SentTransactionNotice tx={tx} explorer={explorer} />
      </div>
    );
  }

  return (
    <div id={`delivery-${fingerprint.slice(2, 10)}`} className="rounded-doc border border-rule p-4">
      <p className="text-sm font-medium">Delivery</p>
      <p className="mt-1 text-xs text-graphite">
        Confirm that what was ordered arrived. The Vault checks this against the invoice before paying.
      </p>

      {!rejecting ? (
        <>
        <div className="mt-3 flex flex-wrap gap-2">
          <ConfirmButton
            businessId={businessId}
            fingerprint={fingerprint}
            wallets={wallets}
            onDone={() => { setState("confirmed"); refreshAfterChain(router); }}
            setStep={setStep}
            setMsg={setMsg}
            step={step}
            tx={tx}
          />
          <button
            id={`btn-reject-delivery-${fingerprint.slice(2, 10)}`}
            onClick={() => setRejecting(true)}
            disabled={step === "signing" || step === "recording" || tx.busy || tx.locked}
            className={buttonClass({ variant: "danger" })}
          >
            Reject delivery
          </button>
        </div>
        {msg ? <p className={`mt-2 text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p> : null}
        <SentTransactionNotice tx={tx} explorer={explorer} />
        </>
      ) : (
        <form
          className="mt-3 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason.trim() || reason.trim().length < 3) return;
            setStep("signing");
            setMsg(null);
            try {
              const wallet = wallets[0];
              if (!wallet) throw new Error("No wallet connected.");
              const prepared = await post(`/api/business/${businessId}/delivery`, {
                action: "prepare_reject",
                fingerprint,
                reason: reason.trim(),
              });
              await wallet.switchChain(prepared.chainId);
              const provider = await wallet.getEthereumProvider();
              const why = reason.trim();
              let finished = false;
              await tx.run({
                send: async () =>
                  (await provider.request({
                    method: "eth_sendTransaction",
                    params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
                  })) as Hex,
                record: (hash) => postRecord(`/api/business/${businessId}/delivery`, { action: "record_reject", fingerprint, txHash: hash, reason: why }),
                onDone: () => {
                  finished = true;
                  setState("rejected");
                  setRejectionReason(why);
                  setStep("done");
                  setRejecting(false);
                  refreshAfterChain(router);
                },
              });
              if (!finished) setStep("idle");
            } catch (ex) {
              setStep("error");
              setMsg(ex instanceof Error ? ex.message : "Something went wrong.");
            }
          }}
        >
          <label htmlFor={`rej-reason-${fingerprint.slice(2, 10)}`} className="block text-sm">
            What's wrong? The vendor will see this.
          </label>
          <input
            id={`rej-reason-${fingerprint.slice(2, 10)}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Two of the four workstations arrived damaged."
            maxLength={500}
            required
            minLength={3}
            className={controlClass}
          />
          <div className="flex gap-2">
            <button
              id={`btn-reject-confirm-${fingerprint.slice(2, 10)}`}
              type="submit"
              disabled={!reason.trim() || reason.trim().length < 3 || step === "signing" || step === "recording" || tx.busy || tx.locked}
              className={buttonClass()}
            >
              {tx.phase === "recording" ? "Recording…" : step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Reject delivery"}
            </button>
            <button
              type="button"
              onClick={() => { setRejecting(false); setMsg(null); setStep("idle"); }}
              className={buttonClass({ variant: "secondary" })}
            >
              Back
            </button>
          </div>
          {msg ? <p className={`text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p> : null}
          <SentTransactionNotice tx={tx} explorer={explorer} />
        </form>
      )}
    </div>
  );
}

// ─── Confirm button shared by the two states ─────────────────────────────────

function ConfirmButton({
  businessId,
  fingerprint,
  wallets,
  onDone,
  setStep,
  setMsg,
  step,
  tx,
}: {
  businessId: string;
  fingerprint: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onDone: () => void;
  setStep: (s: Step) => void;
  setMsg: (m: string | null) => void;
  step: Step;
  tx: SentTransaction;
}) {
  const handleConfirm = async () => {
    setStep("signing");
    setMsg(null);
    try {
      const wallet = wallets[0];
      if (!wallet) throw new Error("No wallet connected.");
      const prepared = await post(`/api/business/${businessId}/delivery`, {
        action: "prepare_confirm",
        fingerprint,
      });
      await wallet.switchChain(prepared.chainId);
      const provider = await wallet.getEthereumProvider();
      let finished = false;
      await tx.run({
        send: async () =>
          (await provider.request({
            method: "eth_sendTransaction",
            params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
          })) as Hex,
        record: (hash) => postRecord(`/api/business/${businessId}/delivery`, { action: "record_confirm", fingerprint, txHash: hash }),
        onDone: () => {
          finished = true;
          setStep("done");
          onDone();
        },
      });
      if (!finished) setStep("idle");
    } catch (ex) {
      setStep("error");
      setMsg(ex instanceof Error ? ex.message : "Something went wrong.");
    }
  };

  return (
    <button
      id={`btn-confirm-delivery-${fingerprint.slice(2, 10)}`}
      onClick={handleConfirm}
      disabled={step === "signing" || step === "recording" || tx.busy || tx.locked}
      className={buttonClass()}
    >
      {tx.phase === "recording" ? "Recording…" : step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Confirm delivery"}
    </button>
  );
}
