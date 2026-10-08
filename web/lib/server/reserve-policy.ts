import "server-only";

import { eq } from "drizzle-orm";
import { getAddress, parseUnits, type PublicClient } from "viem";

import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { businesses, type Database } from "@symbolon/db";

import { requireMember } from "./access";
import { AuthError } from "./errors";
import { prepareChange, type PreparedChangeResult } from "./queued-change";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_BPS = 10_000;

export interface ReservePolicyInput {
  enabled: boolean;
  /** Percent of the Vault's cash that may sit in USYC, 0 to 100, at most two decimals ("30", "12.5") */
  maxReservePercent: string;
  /** USDC that must always stay available, as a decimal string with at most six decimals; zero is allowed */
  minOperating: string;
}

/** "12.5" → 1250 basis points. Refuses anything that is not a percent with at most two decimals. */
export function percentToBps(text: unknown): number {
  if (typeof text !== "string" || !/^\d{1,3}(\.\d{1,2})?$/.test(text.trim())) throw new AuthError(400, "Enter a percentage like 30 or 12.5.");
  const [whole = "0", frac = ""] = text.trim().split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (bps > MAX_BPS) throw new AuthError(400, "The share can't be more than 100%.");
  return bps;
}

function parseFloor(text: unknown): bigint {
  if (typeof text !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(text.trim())) throw new AuthError(400, "Enter the operating floor like 5000 or 5000.50 (up to 6 decimals; 0 is allowed).");
  return parseUnits(text.trim(), 6);
}

/**
 * Prepares the owner-signed `setReservePolicy` call (plan 05zb A2). The Vault decides what is a loosening change (switching
 * the reserve on, raising the share, lowering the floor) and queues it for its delay; `prepareChange` mirrors that so the
 * screen can say which it will be. Switching the reserve on needs Circle's allowlist to be in place already, as the Vault
 * itself requires: refuse here with the reason instead of sending a call that would revert. The owner's wallet signs and the
 * receipt is recorded through the queued-changes route, as for every other gated change.
 */
export async function prepareReservePolicy(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  input: ReservePolicyInput,
): Promise<PreparedChangeResult> {
  await requireMember(db, user.id, businessId, "owner");
  const [b] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b?.vault) throw new AuthError(400, "Create the Vault first.");

  const maxReserveBps = percentToBps(input.maxReservePercent);
  const minOperating = parseFloor(input.minOperating);
  const enabled = input.enabled === true;

  const contracts = symbolonContracts(client, deployment);
  const status = await contracts.lens.read.reserveStatus([getAddress(b.vault)]).catch(() => {
    throw new AuthError(502, "Can't read the reserve from Arc right now. Try again shortly.");
  });
  if (status.usycTeller === ZERO_ADDRESS) throw new AuthError(400, "This Vault's release doesn't support the USYC reserve. Upgrade it first.");
  if (enabled && !status.entitled) throw new AuthError(400, "Circle hasn't allowlisted this Vault for USYC yet, so the reserve can't be switched on.");
  const current = status.policy;
  if (current.enabled === enabled && Number(current.maxReserveBps) === maxReserveBps && current.minOperating === minOperating) {
    throw new AuthError(400, "Nothing changed: these are the settings the Vault already has.");
  }

  return prepareChange(db, client, deployment, user, businessId, {
    kind: "setReservePolicy",
    args: [{ enabled, maxReserveBps, minOperating }],
  });
}
