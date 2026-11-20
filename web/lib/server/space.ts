import "server-only";
import { cookies } from "next/headers";
import { spacesFor, type Spaces } from "./access";
import { getAddress, isAddress } from "viem";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { getDb } from "./db";
import type { CurrentSession } from "./http";
import { checkReleaseNudge } from "./release";
import { readVaultState } from "./vault-read";
import { avatarUrl } from "../avatar-url";
import { avatarVersion } from "./avatar";

/** Which business a person last opened. A convenience only: the server checks membership again on every use (plan 05g, S7). */
export const BUSINESS_COOKIE = "symbolon_business";

export interface Where {
  /** How to name the signed-in person: their email, else their wallet shortened */
  who: string;
  spaces: Spaces;
  /** The business whose screens `/business` shows: the one last opened if they still belong to it, else the first */
  business: Spaces["businesses"][number] | null;
  /** The person's own wallet, shown under their email so they can see which address is their Seal and receives payouts */
  wallet: string | null;
  /** The person's own picture, when they set one (plan 05zs): drawn in the account menu only */
  picture: string | null;
}

export async function loadSpaces(session: CurrentSession, opts: { warmVault?: boolean } = {}): Promise<Where> {
  const db = await getDb();
  const config = getConfig();
  const [spaces, version, jar] = await Promise.all([
    spacesFor(db, session.user.id, config.chainId),
    avatarVersion(db, session.user.id).catch(() => null),
    cookies(),
  ]);
  const wanted = jar.get(BUSINESS_COOKIE)?.value;
  const { email, wallet } = session.user;
  const shown = wallet && isAddress(wallet) ? getAddress(wallet) : wallet;
  const who = email ?? (shown ? `${shown.slice(0, 6)}…${shown.slice(-4)}` : "Signed in");
  const business = spaces.businesses.find((b) => b.id === wanted) ?? spaces.businesses[0] ?? null;
  // A business page's shell asks Arc about this Vault. Starting those reads here lets them run beside the page, and the shell
  // shares them (the read functions are request-scoped caches). Sign-in does not ask: nothing there is waiting on Arc.
  if (opts.warmVault !== false && business?.vault) {
    const client = getClient();
    void readVaultState(client, config.deployment, business.vault);
    void checkReleaseNudge(client, config.deployment, getAddress(business.vault));
  }
  const picture = avatarUrl(session.user.id, version) ?? null;
  return { who, spaces, business, wallet: shown ?? null, picture };
}
