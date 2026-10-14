"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Address } from "@/components/Address";
import { Overlay } from "@/components/Overlay";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { Button } from "@/components/ui/button";
import { DetailList } from "@/components/ui/DetailList";
import { Money } from "@/components/ui/Money";
import { InlineError, InlineLoading } from "@/components/ui/States";
import { SentTransactionNotice, useSentTransaction } from "@/components/wallet/useSentTransaction";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";
import { refreshAfterChain } from "@/lib/client/refresh";
import { showMoney } from "@/lib/format";

interface Prepared {
  ok: true;
  to: string;
  data: string;
  summary: {
    vendor: string;
    invoiceNumber: string;
    amount: string;
    credit: string;
    discountSigned: boolean;
    payoutAddress: string;
    signerWallet: string;
    symbol?: string;
  };
}

interface Refused {
  ok: false;
  reason: string;
}

/**
 * "Pay now" and "Accept offer" on an invoice (plan 05zj C, D2, SYM-05/11): the same wallet payment as Approvals, started from the
 * invoice itself. The server checks every Vault rule and simulates the call before the wallet opens, so what is shown here is the
 * exact amount that will move; a rule that stops it comes back as a reason, never as a failed transaction. An offer is the vendor's
 * signed discount: accepting it is paying the invoice with that discount.
 */
export function PayInvoice({
  businessId,
  fingerprint,
  label,
  offer,
  signer,
  explorer,
  variant = "primary",
  size = "md",
}: {
  businessId: string;
  fingerprint: string;
  label: string;
  /** A signed offer to take (its discount and expiry); without it the best signed discount still valid is used */
  offer?: { discountBps: number; validUntil: number };
  signer: SignerPlan;
  explorer: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const discover = useWalletProviders();
  const tx = useSentTransaction();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/business/${businessId}/approvals`;

  async function start() {
    setOpen(true);
    setChecking(true);
    setPrepared(null);
    setRefused(null);
    setError(null);
    try {
      const answer = await postJson<Prepared | Refused>(path, { action: "prepare-pay", fingerprint, ...(offer ? { offer } : {}) });
      if (answer.ok) setPrepared(answer);
      else setRefused(answer.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check this payment with the Vault.");
    } finally {
      setChecking(false);
    }
  }

  async function confirm() {
    if (!prepared) return;
    setError(null);
    try {
      // Once a hash exists it is kept and checked again, never sent twice
      await tx.run({
        send: () => sendCall(signer, { to: prepared.to, data: prepared.data }, discover),
        record: async (hash) => {
          const recorded = await postRecord<{ ok?: boolean; error?: string }>(path, { action: "record-pay", txHash: hash, fingerprint });
          if (!recorded.ok) throw new Error(recorded.error || "The payment was sent but couldn't be recorded.");
          return recorded;
        },
        onDone: () => {
          setOpen(false);
          refreshAfterChain(router);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send this payment.");
    }
  }

  const close = () => {
    if (tx.busy) return;
    setOpen(false);
    if (tx.phase === "done") tx.reset();
  };

  const symbol = prepared?.summary.symbol ?? "USDC";

  return (
    <>
      <Button variant={variant} size={size} onClick={() => void start()} disabled={signer.kind === "none"}>{label}</Button>
      {open ? (
        <Overlay
          title={offer ? "Accept this offer and pay" : "Pay this invoice now"}
          description="Your wallet sends this payment from the Vault to the vendor. Every Vault rule still applies, and it clears on Arc within moments."
          onClose={close}
        >
          {checking ? <InlineLoading>Checking this payment with the Vault…</InlineLoading> : null}
          {refused ? <InlineError>{refused}</InlineError> : null}
          {error ? <InlineError>{error}</InlineError> : null}
          {prepared ? <p className="text-sm text-seal">The Vault's checks all pass for this payment.</p> : null}
          {prepared ? (
            <DetailList
              stacked
              items={[
                { label: "Vendor", value: prepared.summary.vendor },
                { label: "Invoice", value: prepared.summary.invoiceNumber },
                { label: "Invoice amount", value: <Money>{showMoney(prepared.summary.credit, symbol)}</Money> },
                ...(prepared.summary.discountSigned ? [{ label: "You pay", value: <Money>{showMoney(prepared.summary.amount, symbol)}</Money> }] : []),
                { label: "Paid to", value: <Address value={prepared.summary.payoutAddress} full /> },
                { label: "Paid by", value: <Address value={prepared.summary.signerWallet} full /> },
              ]}
            />
          ) : null}
          {prepared?.summary.discountSigned ? (
            <p className="text-sm text-graphite">The vendor signed this discount for paying early. The ledger checks it again when the payment lands.</p>
          ) : null}
          <SentTransactionNotice tx={tx} explorer={explorer} />
          <Overlay.Footer>
            <Button variant="secondary" onClick={close} disabled={tx.busy}>{tx.locked ? "Close" : "Cancel"}</Button>
            {prepared ? (
              <Button onClick={() => void confirm()} busy={tx.busy} disabled={tx.locked}>{tx.phase === "recording" ? "Confirming…" : tx.busy ? "Sending…" : "Confirm and pay"}</Button>
            ) : null}
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </>
  );
}
