import "server-only";
import { PrivyClient } from "@privy-io/node";
import { getConfig } from "./config";
import { AuthError } from "./errors";
import type { PrivyLike, PrivyUserView } from "./privy-signin";

// The one place the Privy client is built (plan 05k, P10). Everything else takes a `PrivyLike`, so tests never need the service.

let cached: PrivyLike | undefined;

export function getPrivy(): PrivyLike {
  const cfg = getConfig().privy;
  if (!cfg) throw new AuthError(503, "Sign-in isn't set up on this server yet.");
  cached ??= adapt(new PrivyClient({ appId: cfg.appId, appSecret: cfg.appSecret, ...(cfg.verificationKey ? { jwtVerificationKey: cfg.verificationKey } : {}) }), cfg.appId);
  return cached;
}

/** Narrows Privy's user record to what sign-in needs: a verified email and the Ethereum wallets on the account. */
export function viewUser(user: { id: string; linked_accounts: readonly unknown[] }): PrivyUserView {
  let email: string | null = null;
  const wallets: PrivyUserView["wallets"] = [];
  for (const account of user.linked_accounts as { type?: string; address?: string; chain_type?: string; connector_type?: string; verified_at?: number | null }[]) {
    if (account.type === "email" && account.address && typeof account.verified_at === "number" && email === null) email = account.address.toLowerCase();
    if (account.type === "wallet" && account.chain_type === "ethereum" && account.address) {
      wallets.push({ address: account.address.toLowerCase(), kind: account.connector_type === "embedded" ? "embedded" : "external" });
    }
  }
  return { id: user.id, email, wallets };
}

function adapt(client: PrivyClient, appId: string): PrivyLike {
  return {
    appId,
    async verifyAccessToken(token) {
      const claims = await client.utils().auth().verifyAccessToken(token);
      return { userId: claims.user_id, appId: claims.app_id };
    },
    async getUser(userId) {
      // From Privy's API with the app secret, never from anything the browser sent
      return viewUser(await client.users()._get(userId));
    },
  };
}
