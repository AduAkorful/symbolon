"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress, zeroAddress } from "viem";

import { Address } from "@/components/Address";
import { Overlay } from "@/components/Overlay";
import { Button, buttonClass } from "@/components/ui/button";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import { SectionTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";

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
  const router = useRouter();
  const [newPayout, setNewPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedChange | null>(null);

  // said before the button is live, so a mistyped address isn't found out by the server afterwards (plan 05zj F, SYM-33)
  const typed = newPayout.trim();
  const addressProblem =
    typed === ""
      ? null
      : !isAddress(typed)
        ? "That isn't a valid address. It starts with 0x and has 40 more characters, with the right capitals if it has any."
        : getAddress(typed) === zeroAddress
          ? "That is the empty address; nothing can be paid there."
          : currentPayout && getAddress(typed) === getAddress(currentPayout)
            ? "That is already your payout address."
            : getAddress(typed) === getAddress(sealAddress) && !currentPayout
              ? "That is already where you are paid: your Seal's own wallet."
              : null;

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
      router.refresh();
      setSuccess(`Payout change submitted to ${data.count} business Vault(s). Each business owner must confirm it before it becomes active after their Vault's cooldown.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-10 border-t border-rule pt-8">
      <SectionTitle>Change payout address across businesses</SectionTitle>
      <p className="mt-2 text-sm text-graphite max-w-xl">
        To change where your existing Vault counterparties deliver payments, your Seal signs an onchain PayoutChange request.
        Each business must confirm it with their owner key, and the change takes effect only after that Vault&apos;s cooldown (72h default). Signing here is free: your wallet signs a message and sends no transaction, so it needs no USDC for network fees. The business owner&apos;s confirmation is a transaction, and they pay that fee.
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
            className={`${controlClass} font-mono`}
            value={newPayout}
            onChange={(e) => setNewPayout(e.target.value)}
            placeholder="0x…"
            required
            spellCheck={false}
            aria-invalid={addressProblem ? true : undefined}
          />
          {addressProblem ? <span role="alert" className="mt-1 block text-sm text-red">{addressProblem}</span> : null}
        </label>
        <button
          type="submit"
          disabled={busy || !newPayout.trim() || addressProblem !== null}
          className={buttonClass()}
        >
          {busy ? "Checking Vaults…" : "Request payout change"}
        </button>
      </form>

      {/* Confirmation and signature */}
      {prepared ? (
        <Overlay
          title="Confirm the payout change"
          onClose={() => {
            if (!busy) setPrepared(null);
          }}
        >
          <div>
            <p className="mb-1.5 text-graphite">Your Seal will sign a change of payout address to:</p>
            <Address value={prepared.newPayout} full className="text-ink" />
          </div>

          <div className="rounded-doc border border-rule px-4 py-3">
            <p className="font-medium text-ink">Businesses that will be told</p>
            <ul className="mt-2 space-y-1.5">
              {prepared.businesses.map((b) => (
                <li key={b.id} className="min-w-0 text-graphite">
                  <span className="block break-words">{b.name}</span>
                  <Address value={b.vault} full className="text-sm" />
                </li>
              ))}
            </ul>
          </div>

          <p className="text-graphite">
            Each business owner then applies the change on their Vault, and it takes effect after that Vault's waiting period. Invoices
            sealed to the old address can't be paid once the wait is over.
          </p>

          <Overlay.Footer>
            <Button variant="secondary" disabled={busy} onClick={() => setPrepared(null)}>Cancel</Button>
            <Button busy={busy} onClick={handleSignAndSubmit}>{busy ? "Signing…" : "Sign with wallet"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </div>
  );
}
