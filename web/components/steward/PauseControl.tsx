"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const btnBase = "rounded-doc text-xs font-medium transition-colors disabled:opacity-40";

export interface PauseControlProps {
  businessId: string;
  paused: boolean;
  block: string;
  signer: SignerPlan | null;
  explorer?: string;
  compact?: boolean;
}

export function PauseControl({ businessId, paused, block, signer, explorer, compact = false }: PauseControlProps) {
  const router = useRouter();
  const discover = useWalletProviders();
  const [curPaused, setCurPaused] = useState(paused);
  const [curBlock, setCurBlock] = useState(BigInt(block));

  useEffect(() => {
    if (BigInt(block) >= curBlock) {
      setCurPaused(paused);
      setCurBlock(BigInt(block));
    }
  }, [paused, block, curBlock]);

  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tx, setTx] = useState<{ hash: string; did: "pause" | "resume" } | null>(null);

  async function toggle(action: "pause" | "resume") {
    if (!signer || signer.kind === "none") return;
    setBusy("Preparing…");
    setProblem(null);
    try {
      const call = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/vault`, { action });
      setBusy("Waiting for wallet…");
      const hash = await sendCall(signer, call, discover);
      setTx({ hash, did: action });
      setBusy("Confirming on Arc…");
      const want = action === "pause";

      for (let n = 0; n < 20; n++) {
        const r = await fetch(`/api/business/${businessId}/vault`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { kind?: string; block?: string | null };
        if (r.ok && j.kind && (j.kind === "paused") === want && j.block) {
          setCurPaused(want);
          setCurBlock(BigInt(j.block));
          setConfirming(false);
          router.refresh();
          return;
        }
        await wait(2000);
      }
      setProblem("The change isn't showing on Arc yet. Reload in a moment to see where it stands.");
    } catch (e) {
      setProblem(wasRejected(e) ? "You closed the wallet's request." : e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (!signer || signer.kind === "none") {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {curPaused ? (
          <button
            disabled={busy !== null}
            onClick={() => void toggle("resume")}
            className={`${btnBase} bg-paper/20 px-2.5 py-1 text-paper hover:bg-paper/30`}
            title="Resume the Steward and payments"
          >
            {busy ?? "Resume"}
          </button>
        ) : (
          <button
            disabled={busy !== null}
            onClick={() => void toggle("pause")}
            className={`${btnBase} border border-red/60 px-2.5 py-1 text-red hover:bg-red-wash`}
            title="Pause payments and the Steward"
          >
            {busy ?? "Pause"}
          </button>
        )}
        {problem ? <span className="text-[11px] text-red" role="alert">{problem}</span> : null}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {curPaused ? (
        confirming ? (
          <div className="max-w-[56ch] rounded-doc border border-rule p-4 text-sm">
            <p>Resuming lets the Steward act again on this Vault, within the rules the Vault enforces.</p>
            <p className="mt-2 text-graphite">Its mode is shadow: it records what it would do and the app sends nothing, until you change that.</p>
            <div className="mt-3 flex gap-3">
              <button
                disabled={busy !== null}
                onClick={() => void toggle("resume")}
                className={`${btnBase} bg-ink px-3.5 py-1.5 text-sm text-paper`}
              >
                {busy ?? "Resume the Steward (one signature)"}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => setConfirming(false)}
                className={`${btnBase} border border-rule px-3.5 py-1.5 text-sm`}
              >
                Not now
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className={`${btnBase} bg-ink px-3.5 py-1.5 text-sm text-paper`}
          >
            Resume the Steward
          </button>
        )
      ) : (
        <button
          disabled={busy !== null}
          onClick={() => void toggle("pause")}
          className={`${btnBase} border border-red/60 px-3.5 py-1.5 text-sm text-red hover:bg-red-wash`}
        >
          {busy ?? "Pause the Steward (one signature)"}
        </button>
      )}

      {tx && explorer ? (
        <p className="mt-2 text-xs">
          <TxLink href={`${explorer}/tx/${tx.hash}`} label={`View the ${tx.did} transaction on the Arc explorer`}>
            {tx.did === "pause" ? "Pause" : "Resume"} transaction {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
          </TxLink>
        </p>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-2 text-sm text-red">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
