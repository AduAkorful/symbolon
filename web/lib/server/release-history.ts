import "server-only";

import { getAddress, type Address, type PublicClient } from "viem";
import { getReleaseNotes, releases, symbolonContracts, type Deployment } from "@symbolon/chain";
import { displayReleaseNotes } from "../release-notes";
import { readCurrentImplementation } from "./release";

export interface ReleaseHistoryItem {
  version: number;
  implementation: Address;
  /** Seconds, from the registry */
  publishedAt: number;
  revoked: boolean;
  /** This Vault runs it */
  runsHere: boolean;
  /** The newest published release */
  isLatest: boolean;
  notesHash: `0x${string}`;
  /** Release notes whose hash matches the registry's, with internal plan references left out */
  notes: string | null;
  notesTrimmed: boolean;
}

/**
 * Every Vault release this registry has published that the app knows the notes of, newest first (plan 05zc §1). The
 * registry has no list, only `release(implementation)` and `latest()`, and a log scan of its history is slow on a public RPC; so
 * the candidates are the releases Symbolon shipped (the generated list, which `generate` checks against each notes hash) plus
 * the registry's own latest. Each is confirmed by the registry itself. Notes are shown only when they match the onchain hash.
 */
export async function loadReleaseHistory(client: PublicClient, deployment: Deployment, vault: Address | null): Promise<ReleaseHistoryItem[]> {
  const contracts = symbolonContracts(client, deployment);
  const [[latestRaw], currentImpl] = await Promise.all([
    contracts.registry.read.latest(),
    vault ? readCurrentImplementation(client, vault) : Promise.resolve(null),
  ]);
  const latest = getAddress(latestRaw);
  const known = Object.values(releases).filter((r) => r.chainId === deployment.chainId).map((r) => getAddress(r.implementation));
  const candidates = [...new Set([...known, latest])];

  const rows = await Promise.all(
    candidates.map(async (implementation) => {
      const release = await contracts.registry.read.release([implementation]);
      if (release.publishedAt === 0n) return null;
      const info = getReleaseNotes(implementation);
      const verified = Boolean(info && info.notesHash.toLowerCase() === release.notesHash.toLowerCase());
      const shown = verified && info ? displayReleaseNotes(info.notes) : null;
      return {
        version: Number(release.version),
        implementation,
        publishedAt: Number(release.publishedAt),
        revoked: release.revoked,
        runsHere: currentImpl !== null && currentImpl.toLowerCase() === implementation.toLowerCase(),
        isLatest: implementation.toLowerCase() === latest.toLowerCase(),
        notesHash: release.notesHash,
        notes: shown?.text ?? null,
        notesTrimmed: shown?.trimmed ?? false,
      } satisfies ReleaseHistoryItem;
    }),
  );
  return rows.filter((r): r is ReleaseHistoryItem => r !== null).sort((a, b) => b.version - a.version);
}
