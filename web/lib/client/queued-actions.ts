import { postRecord } from "./api";

/** Both queue views use the same supported receipt-recording action. */
export function recordQueuedChange(businessId: string, txHash: string) {
  return postRecord<{ ok: boolean; status?: string }>(`/api/business/${businessId}/queued-changes`, { action: "record", txHash });
}

/** Keep the server's Vault target attached to its calldata all the way to the wallet. */
export async function applyQueuedChange(businessId: string, change: { to: string | null; calldata?: string | null },
  send: (call: { to: string; data: string }) => Promise<string>, onSent?: (hash: string) => void) {
  if (!change.to || !change.calldata) throw new Error("The Vault target or queued calldata is unavailable.");
  const hash = await send({ to: change.to, data: change.calldata });
  // the caller keeps the hash from here: a failed record must lead to "check again", never to a second send
  onSent?.(hash);
  return recordQueuedChange(businessId, hash);
}
