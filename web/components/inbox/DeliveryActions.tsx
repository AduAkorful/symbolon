"use client";

import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import type { Hex } from "viem";

type Step = "idle" | "signing" | "recording" | "done" | "error";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed.");
  return json;
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
}: {
  businessId: string;
  fingerprint: string;
  currentState?: string | null;
  currentReason?: string | null;
  userWallet?: string | null;
}) {
  const { wallets } = useWallets();
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
            onDone={() => { setState("confirmed"); }}
            setStep={setStep}
            setMsg={setMsg}
            step={step}
          />
        </div>
        {msg ? <p className={`mt-2 text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p> : null}
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
        <div className="mt-3 flex flex-wrap gap-2">
          <ConfirmButton
            businessId={businessId}
            fingerprint={fingerprint}
            wallets={wallets}
            onDone={() => { setState("confirmed"); }}
            setStep={setStep}
            setMsg={setMsg}
            step={step}
          />
          <button
            id={`btn-reject-delivery-${fingerprint.slice(2, 10)}`}
            onClick={() => setRejecting(true)}
            disabled={step === "signing" || step === "recording"}
            className="rounded-doc border border-red/60 px-3 py-2 text-sm text-red hover:bg-red-wash disabled:opacity-50"
          >
            Reject delivery
          </button>
        </div>
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
              const txHash: Hex = await provider.request({
                method: "eth_sendTransaction",
                params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
              });
              setStep("recording");
              await post(`/api/business/${businessId}/delivery`, {
                action: "record_reject",
                fingerprint,
                txHash,
                reason: reason.trim(),
              });
              setState("rejected");
              setRejectionReason(reason.trim());
              setStep("done");
              setRejecting(false);
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
            className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              id={`btn-reject-confirm-${fingerprint.slice(2, 10)}`}
              type="submit"
              disabled={!reason.trim() || reason.trim().length < 3 || step === "signing" || step === "recording"}
              className="rounded-doc bg-ink px-3 py-2 text-sm text-paper disabled:opacity-40"
            >
              {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Reject delivery"}
            </button>
            <button
              type="button"
              onClick={() => { setRejecting(false); setMsg(null); setStep("idle"); }}
              className="rounded-doc border border-rule px-3 py-2 text-sm"
            >
              Back
            </button>
          </div>
          {msg ? <p className={`text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p> : null}
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
}: {
  businessId: string;
  fingerprint: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onDone: () => void;
  setStep: (s: Step) => void;
  setMsg: (m: string | null) => void;
  step: Step;
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
      const txHash: Hex = await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
      });
      setStep("recording");
      await post(`/api/business/${businessId}/delivery`, {
        action: "record_confirm",
        fingerprint,
        txHash,
      });
      setStep("done");
      onDone();
    } catch (ex) {
      setStep("error");
      setMsg(ex instanceof Error ? ex.message : "Something went wrong.");
    }
  };

  return (
    <button
      id={`btn-confirm-delivery-${fingerprint.slice(2, 10)}`}
      onClick={handleConfirm}
      disabled={step === "signing" || step === "recording"}
      className="rounded-doc bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-50"
    >
      {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Confirm delivery"}
    </button>
  );
}
