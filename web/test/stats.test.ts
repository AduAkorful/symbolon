import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { getDeployment } from "@symbolon/chain";
import { protocolStreams } from "@symbolon/core";
import { chainEvents, createTestDb, syncCursors } from "@symbolon/db";

vi.mock("server-only", () => ({}));
const { loadProtocolStats, COLLECTED_WITHIN_BLOCKS } = await import("@/lib/server/stats");

const deployment = getDeployment(5042002);
const streams = protocolStreams(deployment);
const ledger = deployment.contracts.invoiceLedger;
const [factoryA, factoryB] = streams.filter((s) => s.kind === "factory").map((s) => s.address);
const HEAD = 70_000_000n;
const at = (head: bigint): PublicClient => ({ getBlockNumber: async () => head }) as unknown as PublicClient;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

let db: Awaited<ReturnType<typeof createTestDb>>;
let nextLog = 0;

async function event(address: string, eventName: string, args: Record<string, unknown>, blockTime: Date | null = new Date("2026-10-01T10:00:00Z")) {
  await db.insert(chainEvents).values({ chainId: deployment.chainId, txHash: hash(++nextLog), logIndex: 0, blockNumber: 64_100_000n + BigInt(nextLog), blockTime, address: address.toLowerCase(), eventName, args });
}
const settled = (o: { seal: number; payer: string; token: string; paid: string }, blockTime?: Date | null) =>
  event(ledger, "Settled", { fingerprint: hash(900 + nextLog), seal: addr(o.seal), payer: o.payer, token: o.token, credit: o.paid, paid: o.paid }, blockTime);
const vaultCreated = (factory: string, vault: string) => event(factory, "VaultCreated", { vault, owner: addr(1), steward: addr(2), implementation: addr(3) });
const readThrough = async (block: bigint) => {
  for (const s of streams) await db.insert(syncCursors).values({ key: s.key, chainId: deployment.chainId, block }).onConflictDoUpdate({ target: syncCursors.key, set: { block } });
};

beforeEach(async () => {
  db = await createTestDb();
  nextLog = 0;
});

describe("protocol stats (plan 05zc §2)", () => {
  it("counts what the events show, keeps tokens apart, and counts only real Vaults as paying Vaults", async () => {
    const vault1 = addr(0x101), vault2 = addr(0x102);
    await vaultCreated(factoryA!, vault1); // an older release's factory
    await vaultCreated(factoryB!, vault2);
    await settled({ seal: 10, payer: vault1, token: deployment.tokens.usdc, paid: "1500000" }); // 1.5 USDC
    await settled({ seal: 10, payer: vault1, token: deployment.tokens.usdc, paid: "2500000" });
    await settled({ seal: 11, payer: vault2, token: deployment.tokens.eurc, paid: "750000" }); // 0.75 EURC
    await settled({ seal: 12, payer: addr(0x999), token: deployment.tokens.usdc, paid: "1000000" }); // paid from a plain wallet
    await settled({ seal: 13, payer: vault1, token: addr(0x777), paid: "5" }); // a token the app has no name for
    await readThrough(HEAD - 10n);

    const stats = await loadProtocolStats(db, at(HEAD), deployment);
    expect(stats.state).toBe("ready");
    expect(stats.network).toMatchObject({ chainId: 5042002, testnet: true });
    expect(stats.numbers).toEqual({
      vaultsCreated: 2,
      invoicesSettled: 5,
      volume: [
        { token: "EURC", amount: "0.75", settled: 1 },
        { token: "USDC", amount: "5", settled: 3 }, // 1.5 + 2.5 + 1.0, never added to EURC
      ],
      otherTokenSettlements: 1,
      sealsPaid: 4,
      payingVaults: 2, // vault1, vault2: the plain wallet is not a Vault
      firstSettlement: "2026-10-01T10:00:00.000Z",
    });
    expect(stats.readThrough).toBe((HEAD - 10n).toString());
  });

  it("ignores events from other contracts and other chains", async () => {
    await event(addr(0xdead), "Settled", { seal: addr(1), payer: addr(2), token: deployment.tokens.usdc, paid: "1000000" });
    await db.insert(chainEvents).values({ chainId: 1, txHash: hash(500), logIndex: 0, blockNumber: 1n, address: ledger.toLowerCase(), eventName: "Settled", args: { seal: addr(1), payer: addr(2), token: deployment.tokens.usdc, paid: "1000000" } });
    await readThrough(HEAD);
    const stats = await loadProtocolStats(db, at(HEAD), deployment);
    expect(stats.numbers?.invoicesSettled).toBe(0);
    expect(stats.numbers?.firstSettlement).toBeNull();
  });

  it("gives no first-settlement date when any settlement's time is unknown", async () => {
    await settled({ seal: 1, payer: addr(2), token: deployment.tokens.usdc, paid: "1" }, null);
    await settled({ seal: 1, payer: addr(2), token: deployment.tokens.usdc, paid: "1" });
    await readThrough(HEAD);
    expect((await loadProtocolStats(db, at(HEAD), deployment)).numbers?.firstSettlement).toBeNull();
  });

  it("shows no number before the mirror has read every stream, or while it is far behind the chain", async () => {
    await settled({ seal: 1, payer: addr(2), token: deployment.tokens.usdc, paid: "1000000" });
    expect(await loadProtocolStats(db, at(HEAD), deployment)).toMatchObject({ state: "collecting", numbers: null, readThrough: null });

    await db.insert(syncCursors).values({ key: streams[0]!.key, chainId: deployment.chainId, block: HEAD }); // only one stream read
    expect((await loadProtocolStats(db, at(HEAD), deployment)).numbers).toBeNull();

    await readThrough(HEAD - COLLECTED_WITHIN_BLOCKS - 1n);
    expect(await loadProtocolStats(db, at(HEAD), deployment)).toMatchObject({ state: "collecting", numbers: null });
  });

  it("says it can't confirm when the chain's head can't be read, instead of guessing", async () => {
    await readThrough(HEAD);
    const broken = { getBlockNumber: async () => { throw new Error("rpc down"); } } as unknown as PublicClient;
    expect(await loadProtocolStats(db, broken, deployment)).toMatchObject({ state: "unconfirmed", numbers: null });
  });

  it("reads the ledger and every release's factory, including the older one that made the first Vault", () => {
    expect(streams.filter((x) => x.kind === "ledger").map((x) => x.address.toLowerCase())).toEqual([ledger.toLowerCase()]);
    const factories = streams.filter((x) => x.kind === "factory");
    expect(factories).toHaveLength(2);
    expect(new Set(factories.map((x) => x.key)).size).toBe(2);
    // each stream starts at its own contract's block, never genesis
    expect(streams.every((x) => x.startBlock > 0n)).toBe(true);
  });
});
