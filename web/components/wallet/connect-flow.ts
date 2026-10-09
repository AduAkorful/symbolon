/** How a connect-a-wallet or sign-in window ended: the person connected one, closed it, or it failed or timed out */
export type ConnectOutcome = "connected" | "closed" | "error";

/** Thrown when Privy has not settled after we have waited. The person can retry. */
export const WALLET_NOT_READY = "Your wallet isn't ready yet. Wait a moment and try again.";

/** A closed Privy window is a choice (EIP-1193 4001), not a failure. */
export function closedWalletRequest(): Error {
  return Object.assign(new Error("You closed the wallet's request, so nothing was sent."), { code: 4001 });
}

async function waitUntil(ok: () => boolean, sleep: (ms: number) => Promise<void>, ms: number): Promise<boolean> {
  for (let waited = 0; waited < ms && !ok(); waited += 100) await sleep(100);
  return ok();
}

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
  if (outcome === "closed") throw closedWalletRequest();
  if (outcome !== "connected") return;
  await waitUntil(() => opts.count() > 0, sleep, opts.settleMs ?? 5_000);
}

/**
 * Our cookie can outlive Privy's session. Before any signing, refresh that session (Privy's `getAccessToken` rotates an
 * expired token) and, if it is gone, open Privy's login — not only the connect window, which needs an authenticated Privy
 * user and does not restore an email/embedded wallet. Then wait for wallets to settle and connect one if the list is still empty.
 */
export async function ensureSignerSession(opts: {
  /** Privy's SDK has initialised (`usePrivy().ready`) */
  privyReady: () => boolean;
  /** The person is authenticated at Privy (`usePrivy().authenticated`). Stale until `privyReady`. */
  authenticated: () => boolean;
  /** Privy has settled the connected-wallet list (`useWallets().ready`) */
  walletsReady: () => boolean;
  walletCount: () => number;
  /** Refreshes an expired Privy access token; null if there is no Privy session to restore */
  refresh: () => Promise<string | null>;
  /** Opens Privy's login window (restores an email/embedded wallet) */
  login: () => Promise<ConnectOutcome>;
  /** Opens Privy's connect window (an external wallet the browser forgot) */
  connect: () => Promise<ConnectOutcome>;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the SDK, then for the wallet list, to settle */
  initMs?: number;
  settleMs?: number;
}): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const initMs = opts.initMs ?? 10_000;
  const settleMs = opts.settleMs ?? 5_000;

  if (!(await waitUntil(opts.privyReady, sleep, initMs))) throw new Error(WALLET_NOT_READY);

  if (!opts.authenticated()) {
    const token = await opts.refresh().catch(() => null);
    if (token) await waitUntil(opts.authenticated, sleep, settleMs);
    else {
      const outcome = await opts.login();
      if (outcome === "closed") throw closedWalletRequest();
      if (outcome === "connected") await waitUntil(opts.authenticated, sleep, settleMs);
    }
  }

  if (!(await waitUntil(opts.walletsReady, sleep, initMs))) throw new Error(WALLET_NOT_READY);

  await ensureWallets({ count: opts.walletCount, prompt: opts.connect, sleep, settleMs });
}
