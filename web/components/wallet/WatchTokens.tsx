"use client";

import { useState } from "react";

import { ensureChain, findWalletFor, wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";

export interface WatchableToken {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Best effort, once per wallet and token in this browser: asks the wallet to remember the tokens just before the person's own
 * transfer, so its approval window names USDC or EURC instead of "Unknown" (QA SYM-20). It runs inside the person's click on the
 * button that sends the deposit, never on its own; a wallet that refuses or doesn't support it is left alone and the transfer goes on.
 */
export async function rememberTokens(providers: Parameters<typeof findWalletFor>[1], signer: SignerPlan, tokens: WatchableToken[]): Promise<void> {
  if (signer.kind !== "wallet" || tokens.length === 0) return;
  const key = (t: WatchableToken) => `symbolon.watched.${signer.chain.chainIdHex}.${signer.address.toLowerCase()}.${t.address.toLowerCase()}`;
  const seen = (t: WatchableToken) => {
    try { return window.localStorage.getItem(key(t)) === "1"; } catch { return false; }
  };
  const todo = tokens.filter((t) => !seen(t));
  if (todo.length === 0) return;
  try {
    const provider = await findWalletFor(signer.address, providers);
    if (!provider) return;
    await ensureChain(provider, signer.chain);
    for (const t of todo) {
      await provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
      } as never);
      try { window.localStorage.setItem(key(t), "1"); } catch { /* the prompt may come again; harmless */ }
    }
  } catch {
    // refused or unsupported: the transfer itself still works, its window may say "Unknown"
  }
}

/**
 * Asks the person's wallet to remember USDC and EURC (EIP-747, `wallet_watchAsset`), so a deposit shows as "USDC" in its approval
 * window instead of "Unknown token" (plan 05zj E, D10 a, SYM-20). Only on the person's click: it opens a wallet prompt, and a
 * wallet that doesn't support it says so rather than failing quietly. The addresses come from the deployment registry.
 */
export function WatchTokens({ signer, tokens, className = "" }: { signer: SignerPlan; tokens: WatchableToken[]; className?: string }) {
  const discover = useWalletProviders();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  if (signer.kind !== "wallet" || tokens.length === 0) return null;

  async function watch() {
    if (signer.kind !== "wallet") return;
    setState("busy");
    setProblem(null);
    try {
      const provider = await findWalletFor(signer.address, await discover());
      if (!provider) throw new Error("No wallet for this account is connected in this browser.");
      await ensureChain(provider, signer.chain);
      for (const t of tokens) {
        await provider.request({
          method: "wallet_watchAsset",
          params: { type: "ERC20", options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
        } as never);
      }
      setState("done");
    } catch (e) {
      setState("idle");
      setProblem(wasRejected(e) ? "You closed the wallet's request, so nothing was added." : "This wallet couldn't add the tokens. You can add them by hand from the token addresses on the explorer.");
    }
  }

  return (
    <p className={`text-xs text-graphite ${className}`}>
      {state === "done" ? (
        "✓ USDC and EURC are in your wallet, so its windows name them."
      ) : (
        <>
          Your wallet may show Symbolon deposits as an “Unknown token”.{" "}
          <button type="button" disabled={state === "busy"} onClick={() => void watch()} className="underline decoration-rule underline-offset-4">
            {state === "busy" ? "Waiting for your wallet…" : "Show USDC and EURC in my wallet"}
          </button>
        </>
      )}
      {problem ? <span role="alert" className="ml-2 text-red">{problem}</span> : null}
    </p>
  );
}
