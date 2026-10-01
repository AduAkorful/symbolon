import { postJson } from "./api";

/** Both queue views use the same supported receipt-recording action. */
export function recordQueuedChange(businessId: string, txHash: string) {
  return postJson<{ ok: boolean; status?: string }>(`/api/business/${businessId}/queued-changes`, { action: "record", txHash });
}

/** Keep the server's Vault target attached to its calldata all the way to the wallet. */
export async function applyQueuedChange(businessId: string, change: { to: string | null; calldata?: string | null },
  send: (call: { to: string; data: string }) => Promise<string>) {
  if (!change.to || !change.calldata) throw new Error("The Vault target or queued calldata is unavailable.");
  const hash = await send({ to: change.to, data: change.calldata });
  return recordQueuedChange(businessId, hash);
}
