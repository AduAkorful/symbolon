import "server-only";
import { cookies } from "next/headers";
import { spacesFor, type Spaces } from "./access";
import { getConfig } from "./config";
import { getDb } from "./db";
import type { CurrentSession } from "./http";

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
  return { who, spaces, business: spaces.businesses.find((b) => b.id === wanted) ?? spaces.businesses[0] ?? null };
}
