"use client";

import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";

interface Props {
  currentPayout: string | null;
  sealAddress: string;
  signer: SignerPlan;
}

interface PreparedChange {
  typedData: string;
  seal: string;
  newPayout: string;
  payoutDomain: number;
  nonce: string;
  businesses: { id: string; name: string; vault: string }[];
}

export function ChangePayoutAddressSection({ currentPayout, sealAddress, signer }: Props) {
  const discover = useWalletProviders();
  const [newPayout, setNewPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedChange | null>(null);

  async function handlePrepare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);

    try {
      const res = await fetch("/api/vendor/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          newPayout: newPayout.trim(),
          payoutDomain: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prepare payout change");
      setPrepared(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignAndSubmit() {
    if (!prepared) return;
    setError(null);
    setBusy(true);

    try {
      const signature = await signTypedData(signer, prepared.typedData, discover);

      const res = await fetch("/api/vendor/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          newPayout: prepared.newPayout,
          payoutDomain: prepared.payoutDomain,
          nonce: prepared.nonce,
          signature,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit payout change");

      setPrepared(null);
      setNewPayout("");
      setSuccess(`Payout change submitted to ${data.count} business Vault(s). Each business owner must confirm it before it becomes active after their Vault's cooldown.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 border-t border-rule pt-8">
      <h2 className="font-display text-2xl">Change payout address across businesses</h2>
      <p className="mt-2 text-sm text-graphite max-w-xl">
        To change where your existing Vault counterparties deliver payments, your Seal signs an onchain PayoutChange request.
        Each business must confirm it with their owner key, and the change takes effect only after that Vault&apos;s cooldown (72h default).
      </p>

      {error ? (
        <div role="alert" className="mt-4 rounded-doc border border-red/40 bg-red-wash p-3 text-sm text-red">
          {error}
        </div>
      ) : null}

      {success ? (
        <div role="status" className="mt-4 rounded-doc border border-seal/40 bg-seal/5 p-3 text-sm text-seal">
          {success}
        </div>
      ) : null}

      <form onSubmit={handlePrepare} className="mt-4 max-w-xl space-y-3">
        <label className="block text-sm">
          New payout address
          <input
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2 font-mono text-sm focus:border-ink focus:outline-none"
            value={newPayout}
            onChange={(e) => setNewPayout(e.target.value)}
            placeholder="0x…"
            required
            spellCheck={false}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !newPayout.trim()}
          className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Checking Vaults..." : "Request Payout Change"}
        </button>
      </form>

      {/* Confirmation & Signature Modal */}
      {prepared ? (
        <Overlay
          label={{ id: "payout-change-modal" }}
          onClose={() => {
            if (!busy) setPrepared(null);
          }}
        >
          <div className="p-7">
            <h3 id="payout-change-modal" className="font-display text-2xl">
              Confirm Payout Change
            </h3>
            <p className="mt-2 text-sm text-graphite">
              Your Seal will sign an onchain payout change to <strong>{prepared.newPayout}</strong>.
            </p>

            <div className="mt-4 rounded-doc border border-rule bg-rule-soft/30 p-3 text-xs">
              <span className="font-medium text-ink">Businesses that will be notified:</span>
              <ul className="mt-2 space-y-1">
                {prepared.businesses.map((b) => (
                  <li key={b.id} className="flex justify-between text-graphite">
                    <span>{b.name}</span>
                    <span className="font-mono">{b.vault.slice(0, 10)}…</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-3 text-xs text-graphite">
              Each business owner must execute the change on their Vault. The change will take effect after their Vault cooldown.
              Invoices sealed to the old address cannot be settled once the cooldown clears.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPrepared(null)}
                className="rounded-doc border border-rule px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignAndSubmit}
                className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Signing..." : "Sign with Wallet"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
