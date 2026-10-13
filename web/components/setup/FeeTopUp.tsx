"use client";

import { useEffect, useRef, useState } from "react";

import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/Field";
import { SentTransactionNotice, useSentTransaction } from "@/components/wallet/useSentTransaction";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";

/** The least that keeps the Steward running: the Steward page warns below this too (0.01 USDC, 18-decimal native units) */
const MIN_FEE = 10_000_000_000_000_000n;

type Fee = { formatted: string; raw: string | null };

/**
 * An optional fee top-up in the Fund step (plan 05zj D, SYM-21). The Steward pays Arc's network fees from its own wallet, which is
 * empty at creation, so a Vault that was funded but never given fees can't send a payment. Same call and record as the Steward page.
 */
export function FeeTopUp({ businessId, signer, explorer }: { businessId: string; signer: SignerPlan; explorer: string }) {
  const discover = useWalletProviders();
  const tx = useSentTransaction();
  const [fee, setFee] = useState<Fee | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const path = `/api/business/${businessId}/steward`;

  async function read(): Promise<Fee | null> {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { fee?: Fee };
      return body.fee ?? null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void read().then(setFee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    if (signer.kind === "none") return;
    setBusy(true);
    setError(null);
    try {
      const prep = await postJson<{ to: string; data: string; value: string }>(path, { action: "prepare-fee", amount });
      await tx.run({
        send: () => sendCall(signer, prep, discover),
        record: (hash) => postRecord(path, { action: "record-fee", txHash: hash }),
        onDone: async () => {
          // the chain needs a moment to show the new balance: ask a few times, never assume
          const before = fee?.raw ? BigInt(fee.raw) : 0n;
          for (let n = 0; n < 8; n++) {
            const now = await read();
            if (now?.raw && BigInt(now.raw) > before) {
              setFee(now);
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        },
      });
    } catch (e) {
      setError(wasRejected(e) ? "You closed the wallet's request, so nothing was sent." : e instanceof Error ? e.message : "Couldn't send the fees.");
    } finally {
      setBusy(false);
    }
  }

  const funded = fee?.raw != null && BigInt(fee.raw) >= MIN_FEE;
  return (
    <div className="mt-8 border-t border-rule pt-4 text-sm">
      <p className="font-medium text-ink">Steward fees</p>
      <p className="mt-1 text-graphite">
        The Steward pays Arc&apos;s network fees from its own wallet, which starts empty. It needs a little USDC there (at least 0.01) before it can send a
        payment. You can do this now or later from the Steward page.
      </p>
      <p className={`mt-2 ${funded ? "text-seal" : "text-graphite"}`} aria-live="polite">
        {fee === null ? "Reading the Steward's balance…" : fee.raw === null ? "Can't confirm the Steward's balance right now." : funded ? `✓ The Steward holds ${fee.formatted}.` : `The Steward holds ${fee.formatted}, not enough yet.`}
      </p>
      {signer.kind !== "none" ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-graphite">
            Amount (USDC)
            <input className={`${controlClass} w-32`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.1" />
          </label>
          <Button variant="secondary" busy={busy || tx.busy} disabled={tx.locked || !amount.trim()} onClick={() => void send()}>
            {busy || tx.busy ? "Sending…" : "Send fees to the Steward"}
          </Button>
        </div>
      ) : null}
      <SentTransactionNotice tx={tx} explorer={explorer} />
      {error ? <p role="alert" className="mt-2 text-red">{error}</p> : null}
    </div>
  );
}
