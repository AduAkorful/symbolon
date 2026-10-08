/**
 * After a transaction the wallet returns a hash before the chain has included it, and Arc's public endpoints lag each other by a
 * few blocks, so a single refresh straight away redraws the page from the old state and nothing ever corrects it (found
 * 2026-10-08 on the Treasury and the Steward fee balance: funded, still unchanged until a manual reload). A page that shows chain
 * facts after a transaction refreshes now and then again a few times; each refresh only redraws what the server reads.
 */
export const CHAIN_REFRESH_DELAYS_MS = [4_000, 10_000, 20_000] as const;

export function refreshAfterChain(router: { refresh: () => void }, schedule: (fn: () => void, ms: number) => unknown = setTimeout): void {
  router.refresh();
  for (const ms of CHAIN_REFRESH_DELAYS_MS) schedule(() => router.refresh(), ms);
}
