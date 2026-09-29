"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { discoverWallets, isUserRejection, signWith, type DiscoveredWallet } from "./wallet";

/** Sign in with a wallet you already use: pick it, then sign a message that says what it's for. It costs nothing and sends no transaction. */
export function WalletSignIn({ onDone }: { onDone: () => void }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function look() {
    setProblem(null);
    setWallets(await discoverWallets());
  }

  async function signIn(w: DiscoveredWallet) {
    setBusy(w.id);
    setProblem(null);
    try {
      const signed = await signWith(w.provider, async (address) => (await postJson<{ message: string }>("/api/auth/wallet/challenge", { address })).message);
      await postJson("/api/auth/wallet/verify", { message: signed.message, signature: signed.signature });
      onDone();
    } catch (e) {
      setProblem(isUserRejection(e) ? "You closed the wallet's request, so nothing was signed." : e instanceof Error ? e.message : "The wallet couldn't sign in.");
      setBusy(null);
    }
  }

  return (
    <div>
      {wallets === null ? (
        <button type="button" onClick={look} className="w-full rounded-doc border border-rule py-3 hover:border-ink">
          Connect a wallet
        </button>
      ) : wallets.length === 0 ? (
        <p role="status" className="rounded-doc border border-rule p-4 text-sm text-graphite">
          No wallet was found in this browser. Install one and reload this page, or sign in with your email instead.
          <button type="button" onClick={look} className="mt-3 block underline decoration-rule underline-offset-4">
            Look again
          </button>
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Wallets in this browser">
          {wallets.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => signIn(w)}
                className="flex w-full items-center gap-3 rounded-doc border border-rule px-4 py-3 text-left hover:border-ink disabled:opacity-50"
              >
                {w.icon ? <img src={w.icon} alt="" width={24} height={24} className="rounded-sm" /> : <span aria-hidden className="h-6 w-6 rounded-sm bg-rule-soft" />}
                <span className="flex-1">{w.name}</span>
                <span className="text-xs text-graphite">{busy === w.id ? "Check your wallet…" : "Sign in"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <p role="alert" className="mt-3 text-sm text-red">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
