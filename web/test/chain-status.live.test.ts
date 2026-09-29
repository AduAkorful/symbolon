import { describe, expect, it } from "vitest";
import { arcTestnet, createArcClient, getDeployment } from "@symbolon/chain";
import { readChainStatus } from "@/lib/server/chain-status";

describe.skipIf(!process.env.LIVE)("readChainStatus (live, Arc testnet)", () => {
  it("finds every registry contract on the node", async () => {
    const d = getDeployment(arcTestnet.id);
    const s = await readChainStatus(createArcClient(arcTestnet.id, process.env.ARC_RPC_URL || undefined), d);
    expect(s.checks.filter((c) => !c.ok)).toEqual([]);
    expect(s.ok).toBe(true);
    expect(s.block! > d.startBlock).toBe(true);
  });
});
