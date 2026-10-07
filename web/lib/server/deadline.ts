/** A read that takes longer than this is treated as failed: the screen says it can't confirm, it doesn't wait on a slow node */
export const CHAIN_READ_DEADLINE_MS = 15_000;

/**
 * Rejects when `work` hasn't finished by `ms`. The work itself isn't cancelled (a viem read can't be); its result is dropped
 * and any later failure is swallowed so it never becomes an unhandled rejection.
 */
export function withDeadline<T>(work: Promise<T>, ms = CHAIN_READ_DEADLINE_MS, what = "The read"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} seconds.`)), ms);
  });
  work.catch(() => undefined);
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
