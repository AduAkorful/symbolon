import { describe, expect, it } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { readChainStatus, type StatusClient } from "@/lib/server/chain-status";

const d = getDeployment(arcTestnet.id);
const NOW = new Date("2026-09-29T12:00:00Z");

function client(over: Partial<StatusClient> = {}): StatusClient {
  return {
    getChainId: async () => d.chainId,
    getBlockNumber: async () => d.startBlock + 1000n,
    getCode: async () => "0x6080",
    ...over,
  };
}

describe("readChainStatus", () => {
  it("is ok when the chain matches and every registry address has code", async () => {
    const s = await readChainStatus(client(), d, NOW);
    expect(s.ok).toBe(true);
    expect(s.block).toBe(d.startBlock + 1000n);
    expect(s.readAt).toEqual(NOW);
    expect(s.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails closed when the node reports a different chain, and doesn't trust its contract reads", async () => {
    let codeCalls = 0;
    const s = await readChainStatus(client({ getChainId: async () => 1, getCode: async () => { codeCalls++; return "0x6080"; } }), d, NOW);
    expect(s.ok).toBe(false);
    expect(s.checks[0]).toMatchObject({ name: "Chain", ok: false });
    expect(s.checks[0]!.detail).toMatch(/expected 5042002.*got 1/s);
    expect(codeCalls).toBe(0);
  });

  it("names the contract whose address has no code", async () => {
    const s = await readChainStatus(client({ getCode: async ({ address }) => (address === d.contracts.vaultLens ? undefined : "0x6080") }), d, NOW);
    expect(s.ok).toBe(false);
    const bad = s.checks.filter((c) => !c.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.name).toBe("Vault lens");
  });

  it("treats empty code ('0x') as missing", async () => {
    const s = await readChainStatus(client({ getCode: async () => "0x" }), d, NOW);
    expect(s.ok).toBe(false);
  });

  it("fails when the node's head is behind the deployment block", async () => {
    const s = await readChainStatus(client({ getBlockNumber: async () => d.startBlock - 1n }), d, NOW);
    expect(s.ok).toBe(false);
    expect(s.checks.find((c) => c.name === "Head")).toMatchObject({ ok: false });
  });

  it("reports an unreachable node instead of throwing", async () => {
    const s = await readChainStatus(client({ getChainId: async () => { throw new Error("connect ECONNREFUSED"); } }), d, NOW);
    expect(s.ok).toBe(false);
    expect(s.block).toBeUndefined();
    expect(s.checks[0]!.detail).toMatch(/ECONNREFUSED/);
  });

  it("reports a code read that throws as a failed check for that contract", async () => {
    const s = await readChainStatus(client({ getCode: async ({ address }) => { if (address === d.contracts.invoiceLedger) throw new Error("timeout"); return "0x6080"; } }), d, NOW);
    expect(s.ok).toBe(false);
    expect(s.checks.find((c) => c.name === "Invoice ledger")!.detail).toMatch(/timeout/);
  });
});
