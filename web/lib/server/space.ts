import "server-only";
import { cookies } from "next/headers";
import { spacesFor, type Spaces } from "./access";
import { getAddress } from "viem";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { getDb } from "./db";
import type { CurrentSession } from "./http";
import { checkReleaseNudge } from "./release";
import { readVaultState } from "./vault-read";

/** Which business a person last opened. A convenience only: the server checks membership again on every use (plan 05g, S7). */
export const BUSINESS_COOKIE = "symbolon_business";

export interface Where {
  /** How to name the signed-in person: their email, else their wallet shortened */
  who: string;
  spaces: Spaces;
  /** The business whose screens `/business` shows: the one last opened if they still belong to it, else the first */
  business: Spaces["businesses"][number] | null;
}

export async function loadSpaces(session: CurrentSession): Promise<Where> {
  const spaces = await spacesFor(await getDb(), session.user.id, getConfig().chainId);
  const wanted = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const { email, wallet } = session.user;
  const who = email ?? (wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Signed in");
  const business = spaces.businesses.find((b) => b.id === wanted) ?? spaces.businesses[0] ?? null;
  // Every business page's shell asks Arc about this Vault (is the Steward paused, is a newer release out). Starting those reads
  // here, before the page does its own work, means they run beside it instead of after it, and the shell and the page share them
  // (the read functions are request-scoped caches). Nothing waits on them here; the shell does.
  if (business?.vault) {
    const config = getConfig();
    const client = getClient();
    void readVaultState(client, config.deployment, business.vault);
    void checkReleaseNudge(client, config.deployment, getAddress(business.vault));
  }
  return { who, spaces, business };
}
