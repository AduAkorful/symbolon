import "server-only";
import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { getAddress } from "viem";
import { chainEvents } from "@symbolon/db";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { getDb } from "./db";
import { menuReleaseNudge } from "./release";
import { pauseStateOf, readVaultState, stewardStanding, type PauseState } from "./vault-read";

// Plan 05zd F2. What the page frame says about the Vault (the Steward chip, the pause control, the pause banner, the release dot)
// needs Arc to answer, so it arrives after the page instead of holding it up. Every piece asks for the same one result per request.

export interface ShellVault {
  standing: ReturnType<typeof stewardStanding> | null;
  pauseState: PauseState;
  paused: boolean;
  pauseTxHash: string | null;
  hasReleaseNudge: boolean;
}

const UNKNOWN: ShellVault = { standing: null, pauseState: { known: false }, paused: false, pauseTxHash: null, hasReleaseNudge: false };

/** One read of the Vault for this request, shared by every piece of the frame that needs it. Never throws: a failed read is "can't confirm". */
export const loadShellVault = cache(async (vault: string, stewardWallet: string | null): Promise<ShellVault> => {
  try {
    const config = getConfig();
    const client = getClient();
    const [state, nudge] = await Promise.all([
      readVaultState(client, config.deployment, vault),
      menuReleaseNudge(client, config.deployment, getAddress(vault)).catch(() => ({ hasNudge: false })),
    ]);
    const paused = state.ok && state.paused;
    let pauseTxHash: string | null = null;
    if (paused) {
      try {
        const [row] = await (await getDb())
          .select({ txHash: chainEvents.txHash })
          .from(chainEvents)
          .where(and(eq(chainEvents.address, getAddress(vault).toLowerCase()), eq(chainEvents.eventName, "Paused")))
          .orderBy(desc(chainEvents.blockNumber))
          .limit(1);
        pauseTxHash = row?.txHash ?? null;
      } catch (e) {
        console.error("reading the pause transaction failed", e);
      }
    }
    return { standing: stewardStanding(stewardWallet, state), pauseState: pauseStateOf(state), paused, pauseTxHash, hasReleaseNudge: nudge.hasNudge };
  } catch (e) {
    console.error("reading Vault state for the shell failed", e);
    return UNKNOWN;
  }
});
