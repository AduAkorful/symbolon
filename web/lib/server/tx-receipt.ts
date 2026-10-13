import "server-only";
import type { Hex, PublicClient, TransactionReceipt } from "viem";
import { AuthError } from "./errors";

/** The reason code a screen retries on: the transaction was sent, Arc just hasn't shown it to this request yet */
export const TX_PENDING = "tx_pending";

const WAIT_MS = 20_000;
const POLL_MS = 1_000;

/** True for viem's "no receipt for this hash yet", which is an answer from the endpoint, not a failure of the transaction */
function isNotFound(error: unknown): boolean {
  for (let e: unknown = error, i = 0; e && i < 6; i++, e = (e as { cause?: unknown }).cause) {
    if ((e as { name?: string }).name === "TransactionReceiptNotFoundError") return true;
  }
  return false;
}

/**
 * The receipt of a transaction the person's wallet has already sent (plan 05zj A, SYM-03).
 *
 * Arc's public endpoints lag each other by a few blocks. An endpoint that hasn't seen the block answers "no receipt", which the RPC
 * pool rightly passes on as an answer. Reading once therefore turned a confirmed transaction into "isn't confirmed yet" (and, in
 * places, a 500), while the funds had moved. So this waits: a missing receipt is "still confirming" until the budget is spent, and
 * even then it is a retryable answer with its own code, never a failure. Any other read error ends the wait with the same retryable
 * answer, because the transaction is not known to have failed.
 */
export async function awaitReceipt(
  client: Pick<PublicClient, "getTransactionReceipt">,
  hash: Hex,
  opts: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<TransactionReceipt> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (opts.timeoutMs ?? WAIT_MS);
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (e) {
      if (!isNotFound(e)) {
        throw new AuthError(409, "That transaction isn't confirmed yet, or the chain can't be reached right now. Checking again in a moment.", TX_PENDING);
      }
      if (now() >= deadline) {
        throw new AuthError(409, "That transaction isn't confirmed yet. Arc is still catching up; checking again in a moment.", TX_PENDING);
      }
      await sleep(opts.pollMs ?? POLL_MS);
    }
  }
}
