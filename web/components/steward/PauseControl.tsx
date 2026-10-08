"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ProblemDialog } from "@/components/ProblemDialog";
import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { Button } from "@/components/ui/button";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PauseControlProps {
  businessId: string;
  paused: boolean;
  block: string;
  /** False when the Vault's paused state couldn't be read: the owner can still pause, and the screen says so */
  known?: boolean;
  signer: SignerPlan | null;
  explorer?: string;
  compact?: boolean;
}

export function PauseControl({ businessId, paused, block, known = true, signer, explorer, compact = false }: PauseControlProps) {
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
  const [problem, setProblem] = useState<{ doing: "pause" | "resume"; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tx, setTx] = useState<{ hash: string; did: "pause" | "resume" } | null>(null);

  async function toggle(action: "pause" | "resume") {
    if (!signer || signer.kind === "none") return;
    setBusy("Preparing…");
    setProblem(null);
    const fail = (message: string) => setProblem({ doing: action, message });
    try {
      const call = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/vault`, { action });
      setBusy("Waiting for wallet…");
      const hash = await sendCall(signer, call, discover);
      setTx({ hash, did: action });
      setBusy("Confirming on Arc…");
      const want = action === "pause";

      for (let n = 0; n < 20; n++) {
        const r = await fetch(`/api/business/${businessId}/vault`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { paused?: boolean | null; block?: string | null };
        // The Vault's own flag decides, whether or not its Steward matches what we recorded
        if (r.ok && typeof j.paused === "boolean" && j.paused === want && j.block) {
          setCurPaused(want);
          setCurBlock(BigInt(j.block));
          setConfirming(false);
          router.refresh();
          return;
        }
        await wait(2000);
      }
      fail("The change isn't showing on Arc yet. Reload in a moment to see where it stands.");
    } catch (e) {
      fail(wasRejected(e) ? "You closed the wallet's request, so nothing was sent." : e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (!signer || signer.kind === "none") {
    return null;
  }

  const dialog = problem ? (
    <ProblemDialog
      title={problem.doing === "pause" ? "Couldn’t pause payments" : "Couldn’t resume payments"}
      message={problem.message}
      onClose={() => setProblem(null)}
    />
  ) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {curPaused ? (
          <Button size="sm" busy={busy !== null} onClick={() => void toggle("resume")} title="Resume the Steward and payments">
            {busy ?? (<><span className="sm:hidden">Resume</span><span className="hidden sm:inline">Resume payments</span></>)}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="danger"
            busy={busy !== null}
            onClick={() => void toggle("pause")}
            title={known ? "Pause payments and the Steward" : "Pause payments and the Steward. We can't confirm the Vault's current state."}
          >
            {busy ?? (<><span className="sm:hidden">Pause</span><span className="hidden sm:inline">Pause payments</span></>)}
          </Button>
        )}
        {dialog}
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
            <div className="mt-4 flex flex-wrap gap-3">
              <Button busy={busy !== null} onClick={() => void toggle("resume")}>
                {busy ?? "Resume the Steward (one signature)"}
              </Button>
              <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setConfirming(true)}>Resume the Steward</Button>
        )
      ) : (
        <Button variant="danger" busy={busy !== null} onClick={() => void toggle("pause")}>
          {busy ?? "Pause the Steward (one signature)"}
        </Button>
      )}
      {!known && !curPaused ? <p className="mt-2 text-xs text-graphite">We can't confirm whether the Vault is paused right now. You can still pause it.</p> : null}

      {tx && explorer ? (
        <p className="mt-2 text-xs">
          <TxLink href={`${explorer}/tx/${tx.hash}`} label={`View the ${tx.did} transaction on the Arc explorer`}>
            {tx.did === "pause" ? "Pause" : "Resume"} transaction {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
          </TxLink>
        </p>
      ) : null}

      {dialog}
    </div>
  );
}
