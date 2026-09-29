import "server-only";
import { createCircleClient, provisionStewardWallet } from "@symbolon/steward";
import type { ProvisionSteward } from "./business";
import { getConfig } from "./config";

// Plan 05h, H10–H11: where a business's Steward wallet comes from.
// Circle's developer-controlled wallets when the API key and entity secret are set; otherwise nothing, and the Vault is not
// created (fail closed). There is no local-key fallback.

let circle: ReturnType<typeof createCircleClient> | undefined;

export function getStewardProvisioner(): ProvisionSteward | null {
  const cfg = getConfig();
  const c = cfg.stewardCircle;
  if (c) {
    circle ??= createCircleClient(c.apiKey, c.entitySecret);
    const client = circle;
    return async (businessId) =>
      (await provisionStewardWallet(client, { chainId: cfg.chainId, refId: businessId, ...(c.walletSetId ? { walletSetId: c.walletSetId } : {}) })).address;
  }
  return null;
}
