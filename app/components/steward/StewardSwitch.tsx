"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { sendCall, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { postJson } from "@/lib/client/api";

// Plan 05h, H14. The owner's pause / resume for the Steward. What it shows is what the chain says; a click never changes the
// label, only a read of the Vault does.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const button = "rounded-doc px-3.5 py-1.5 text-sm font-medium disabled:opacity-40";

type Shown = { state: "paused" | "active"; block: bigint };

/**
 * The Steward row on the business home: its state as the chain last showed it, the wallet, and (for the owner) the switch.
 * Arc's RPC backends can be a few blocks apart, so a page refresh right after a confirmed change may still read the old state.
 * This keeps the state it confirmed and only takes a newer one from the server, never an older block.
 */
export function StewardSwitch(props: { businessId: string; state: "paused" | "active"; block: string; steward: string; signer: SignerPlan | null; explorer: string }) {
  const router = useRouter();
  const discover = useWalletProviders();
  const [shown, setShown] = useState<Shown>({ state: props.state, block: BigInt(props.block) });
  useEffect(() => {
    setShown((cur) => (BigInt(props.block) >= cur.block ? { state: props.state, block: BigInt(props.block) } : cur));
  }, [props.state, props.block]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tx, setTx] = useState<{ hash: string; did: "pause" | "resume" } | null>(null);
  const paused = shown.state === "paused";

  async function change(action: "pause" | "resume") {
    if (!props.signer) return;
    setBusy("Preparing…");
    setProblem(null);
    try {
      const call = await postJson<{ to: string; data: string }>(`/api/business/${props.businessId}/vault`, { action });
      setBusy("Waiting for your wallet…");
      const hash = await sendCall(props.signer, call, discover);
      setTx({ hash, did: action });
      setBusy("Confirming on Arc…");
      const want = action === "pause" ? "paused" : "active";
      for (let n = 0; n < 20; n++) {
        const r = await fetch(`/api/business/${props.businessId}/vault`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { kind?: string; block?: string | null };
        if (r.ok && j.kind === want && j.block) {
          setShown((cur) => (BigInt(j.block!) >= cur.block ? { state: want, block: BigInt(j.block!) } : cur));
          setConfirming(false);
          router.refresh();
          return;
        }
        await wait(2000);
      }
      setProblem("The change isn't showing on Arc yet. Reload in a moment to see where it stands.");
    } catch (e) {
      setProblem(wasRejected(e) ? "You closed the wallet's request, so nothing was sent." : e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const signer = props.signer;
  const controls =
    signer === null ? null : signer.kind === "none" ? (
      <p className="mt-2 text-xs text-graphite">{signer.reason}</p>
    ) : (
      <div className="mt-3">
        {paused ? (
          confirming ? (
            <div className="max-w-[56ch] rounded-doc border border-rule p-4 text-sm">
              <p>Resuming lets the Steward act again on this Vault, within the rules the Vault enforces.</p>
              <p className="mt-2 text-graphite">Its mode is shadow: it records what it would do and the app sends nothing, until you change that.</p>
              <div className="mt-3 flex gap-3">
                <button disabled={busy !== null} onClick={() => void change("resume")} className={`${button} bg-ink text-paper`}>
                  {busy ?? "Resume the Steward (one signature)"}
                </button>
                <button disabled={busy !== null} onClick={() => setConfirming(false)} className={`${button} border border-rule`}>
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className={`${button} bg-ink text-paper`}>
              Resume the Steward
            </button>
          )
        ) : (
          <button disabled={busy !== null} onClick={() => void change("pause")} className={`${button} border border-red/60 text-red hover:bg-red-wash`}>
            {busy ?? "Pause the Steward (one signature)"}
          </button>
        )}
        {tx ? (
          <p className="mt-2 text-xs">
            <TxLink href={`${props.explorer}/tx/${tx.hash}`} label={`View the ${tx.did} transaction ${tx.hash} on the Arc explorer`}>
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

  return (
    <>
      <span className={paused ? "text-red" : "text-ink"}>{paused ? "Paused" : "Active"}</span>
      <span className="ml-2 text-xs text-graphite">
        {paused ? "It can’t pay anything until you resume it. " : "It can act within the Vault’s rules. "}
        Read from Arc at block {shown.block.toString()}.
      </span>
      <span className="mt-1 block">
        <TxLink href={`${props.explorer}/address/${props.steward}`} label="View the Steward's wallet on the Arc explorer" className="break-all">
          {props.steward}
        </TxLink>
      </span>
      {controls}
    </>
  );
}
