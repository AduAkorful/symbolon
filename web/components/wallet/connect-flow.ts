/** How a connect-a-wallet window ended: the person connected one, closed it, or it failed or timed out */
export type ConnectOutcome = "connected" | "closed" | "error";

/**
 * Plan 05zi. A signing action needs a wallet. If Privy lists none (the browser forgot the connection while our own session lasted),
 * ask for one; a closed window is a refusal the signers already treat as a choice (code 4001), and anything else leaves the signer
 * to explain with what it has. Kept apart from React so the decisions can be tested without a wallet.
 */
export async function ensureWallets(opts: {
  /** How many wallets Privy lists right now */
  count: () => number;
  /** Opens the connect window and says how it ended */
  prompt: () => Promise<ConnectOutcome>;
  sleep?: (ms: number) => Promise<void>;
  /** After "connected", how long to wait for the wallet to show up in the list (Privy updates it a moment later) */
  settleMs?: number;
}): Promise<void> {
  if (opts.count() > 0) return;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const outcome = await opts.prompt();
  if (outcome === "closed") throw Object.assign(new Error("You closed the wallet's request, so nothing was sent."), { code: 4001 });
  if (outcome !== "connected") return;
  for (let waited = 0; waited < (opts.settleMs ?? 5_000) && opts.count() === 0; waited += 100) await sleep(100);
}
