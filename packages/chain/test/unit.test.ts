import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decodeFunctionData, keccak256, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  arcChain,
  arcTestnet,
  changeIdOf,
  getDeployment,
  noDiscount,
  offerDiscount,
  payCall,
  scanLogs,
  symbolonVaultAbi,
  tierDiscount,
  toTransaction,
  vaultCall,
  withSlippage,
  getReleaseNotes,
} from "../src/index.js";
import { generateAbis, generateDeployments, generateReleases } from "../scripts/generate.js";

const generated = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../src/generated/${name}`, import.meta.url)), "utf8");

describe("generated files", () => {
  it("match the current forge build and deployment registry (run `pnpm generate` after changes)", () => {
    expect(generateAbis()).toBe(generated("abis.ts"));
    expect(generateDeployments()).toBe(generated("deployments.ts"));
    expect(generateReleases()).toBe(generated("releases.ts"));
  });
});


describe("chains", () => {
  it("uses docs.arc.io URLs, never viem's stale ones", () => {
    const urls = JSON.stringify([arcTestnet.rpcUrls, arcTestnet.blockExplorers]);
    expect(urls).toContain("rpc.testnet.arc.io");
    expect(urls).toContain("explorer.testnet.arc.io");
    expect(urls).not.toMatch(/arc\.network|arcscan/);
    expect(arcTestnet.id).toBe(5_042_002);
    expect(() => arcChain(1)).toThrow(/unsupported chain/);
  });
});

describe("deployment registry", () => {
  it("exposes the Arc testnet deployment with checksummed addresses", () => {
    const d = getDeployment(arcTestnet.id);
    expect(d.cctpDomain).toBe(26);
    expect(d.startBlock).toBeGreaterThan(0n);
    expect(d.releaseVersion).toBeGreaterThanOrEqual(2);
    for (const a of Object.values(d.contracts)) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(d.usycTeller).toBeDefined();
    expect(d.tokens.usyc).toBeDefined();
    expect(() => getDeployment(1)).toThrow(/no Symbolon deployment/);
  });
});

describe("calls", () => {
  const vault = "0x5F5e2cd9F87A81724Cc48eC0C193630a60692984";

  it("encodes pay with defaults and decodes back", () => {
    const invoice = {
      seal: "0x0000000000000000000000000000000000000001",
      token: "0x3600000000000000000000000000000000000000",
      amount: 1_000_000n,
      issuedAt: 1n,
      dueDate: 2n,
      payoutAddress: "0x0000000000000000000000000000000000000002",
      payoutDomain: 26,
      payerRef: `0x${"00".repeat(32)}`,
      invoiceNumberHash: `0x${"11".repeat(32)}`,
      poRef: `0x${"00".repeat(32)}`,
      documentHash: `0x${"22".repeat(32)}`,
      replaces: `0x${"00".repeat(32)}`,
      earlyPay: [{ payBy: 5n, discountBps: 100 }],
    } as const;
    const call = payCall(vault, { invoice, sealSig: "0xabcd", credit: 1_000_000n, decisionHash: `0x${"33".repeat(32)}` });
    const { to, data } = toTransaction(call);
    expect(to).toBe(vault);
    const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data });
    expect(decoded.functionName).toBe("pay");
    const [params, approvals] = decoded.args as unknown as [{ credit: bigint; maxFee: bigint; discount: { kind: number } }, unknown[]];
    expect(params.credit).toBe(1_000_000n);
    expect(params.maxFee).toBe(0n);
    expect(params.discount.kind).toBe(0);
    expect(approvals).toEqual([]);
  });

  it("builds discount proofs", () => {
    expect(noDiscount().kind).toBe(0);
    expect(tierDiscount(1)).toMatchObject({ kind: 1, tierIndex: 1n });
    expect(offerDiscount(200, 9n, "0x01")).toMatchObject({ kind: 2, offerBps: 200, offerValidUntil: 9n, offerSig: "0x01" });
  });

  it("derives a queued change's id from its exact calldata, like the Vault's _gate", () => {
    const call = vaultCall(vault, "setSteward", ["0x0000000000000000000000000000000000000003"]);
    expect(changeIdOf(call)).toBe(keccak256(toTransaction(call).data));
    const other = vaultCall(vault, "setSteward", ["0x0000000000000000000000000000000000000004"]);
    expect(changeIdOf(other)).not.toBe(changeIdOf(call));
  });

  it("applies slippage rounding down", () => {
    expect(withSlippage(1_000_000n, 50)).toBe(995_000n);
    expect(withSlippage(999n, 1)).toBe(998n);
    expect(() => withSlippage(1n, 10_001)).toThrow(RangeError);
  });
});

describe("scanLogs", () => {
  const events = [] as const;

  it("refuses to scan from genesis", async () => {
    const client = { getBlockNumber: vi.fn() } as unknown as PublicClient;
    await expect(scanLogs(client, { address: "0x0000000000000000000000000000000000000001", events, fromBlock: 0n })).rejects.toThrow(/startBlock/);
  });

  it("halves the range when the RPC refuses it, and reports how far it scanned", async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: vi.fn(async () => 1_000n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 250n) throw new Error("range too large");
        ranges.push([fromBlock, toBlock]);
        return [];
      }),
    } as unknown as PublicClient;
    const result = await scanLogs(client, {
      address: "0x0000000000000000000000000000000000000001",
      events,
      fromBlock: 1n,
      chunk: 1_000n,
      minChunk: 100n,
    });
    expect(result.scannedTo).toBe(1_000n);
    expect(ranges[0]).toEqual([1n, 250n]);
    expect(ranges.at(-1)?.[1]).toBe(1_000n);
    // contiguous, no gaps or overlaps
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]![0]).toBe(ranges[i - 1]![1] + 1n);
  });

  it("reads ranges in parallel without gaps or overlaps, and returns logs in block order", async () => {
    let inFlight = 0;
    let peak = 0;
    const ranges: [bigint, bigint][] = [];
    const client = {
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        ranges.push([fromBlock, toBlock]);
        // later ranges answer first, so ordering must come from the sort, not from arrival
        return [{ blockNumber: toBlock, logIndex: 0 }];
      }),
    } as unknown as PublicClient;
    const result = await scanLogs(client, {
      address: "0x0000000000000000000000000000000000000001",
      events,
      fromBlock: 1n,
      toBlock: 1_000n,
      chunk: 100n,
      minChunk: 100n,
      concurrency: 4,
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    const sorted = [...ranges].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(sorted).toHaveLength(10);
    sorted.forEach((r, i) => expect(r).toEqual([BigInt(i) * 100n + 1n, BigInt(i + 1) * 100n]));
    const blocks = result.logs.map((l) => l.blockNumber);
    expect(blocks).toEqual([...blocks].sort((a, b) => (a < b ? -1 : 1)));
    expect(result.scannedTo).toBe(1_000n);
  });

  it("waits and asks again when the provider says it is rate limiting, instead of asking for less", async () => {
    const asked: bigint[] = [];
    let limited = 2;
    const client = {
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        asked.push(toBlock - fromBlock + 1n);
        if (limited-- > 0) throw new Error("rate limit exceeded");
        return [];
      }),
    } as unknown as PublicClient;
    const result = await scanLogs(client, { address: "0x0000000000000000000000000000000000000001", events, fromBlock: 1n, toBlock: 1_000n, chunk: 1_000n, minChunk: 100n, backoffMs: 1 });
    expect(result.scannedTo).toBe(1_000n);
    expect(asked).toEqual([1_000n, 1_000n, 1_000n]); // the same range, never a smaller one
  });

  it("gives up with the provider's own error when the rate limit doesn't lift", async () => {
    const client = { getLogs: vi.fn(async () => { throw new Error("Request exceeds defined limit."); }) } as unknown as PublicClient;
    await expect(
      scanLogs(client, { address: "0x0000000000000000000000000000000000000001", events, fromBlock: 1n, toBlock: 1_000n, chunk: 1_000n, backoffMs: 1 }),
    ).rejects.toThrow(/exceeds defined limit/);
    expect(client.getLogs).toHaveBeenCalledTimes(5); // one try and four more after waiting
  });

  it("stops and throws when a range can't be read even at the smallest size", async () => {
    const client = {
      getLogs: vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => {
        if (fromBlock > 300n) throw new Error("rpc down");
        return [];
      }),
    } as unknown as PublicClient;
    await expect(
      scanLogs(client, { address: "0x0000000000000000000000000000000000000001", events, fromBlock: 1n, toBlock: 1_000n, chunk: 200n, minChunk: 100n, concurrency: 3 }),
    ).rejects.toThrow("rpc down");
  });
});

import { cctpMaxFee, ledgerCall } from "../src/index.js";

describe("CCTP fees", () => {
  const fetcher = (minimumFee: number) =>
    (async () => ({ ok: true, json: async () => [{ finalityThreshold: 1000, minimumFee: 99 }, { finalityThreshold: 2000, minimumFee }] })) as unknown as typeof fetch;

  it("uses the standard-finality minimum, rounding up, plus headroom", async () => {
    expect(await cctpMaxFee(1_000_000n, 26, 0, "testnet", { fetcher: fetcher(0) })).toBe(0n);
    expect(await cctpMaxFee(1_000_000n, 26, 0, "testnet", { fetcher: fetcher(1) })).toBe(100n); // 1 bps
    expect(await cctpMaxFee(1_000_001n, 26, 0, "testnet", { fetcher: fetcher(1.3) })).toBe(131n); // 130.00013 → 131
    expect(await cctpMaxFee(1_000_000n, 26, 0, "testnet", { fetcher: fetcher(1), headroomBps: 2 })).toBe(300n);
  });

  it("builds ledger calls", () => {
    const call = ledgerCall("0x7EFf84D0715284FA3d793525151b30a05Af45aCE", "cancel", [
      {
        seal: "0x0000000000000000000000000000000000000001",
        token: "0x0000000000000000000000000000000000000002",
        amount: 1n,
        issuedAt: 0n,
        dueDate: 0n,
        payoutAddress: "0x0000000000000000000000000000000000000003",
        payoutDomain: 26,
        payerRef: `0x${"00".repeat(32)}`,
        invoiceNumberHash: `0x${"00".repeat(32)}`,
        poRef: `0x${"00".repeat(32)}`,
        documentHash: `0x${"00".repeat(32)}`,
        replaces: `0x${"00".repeat(32)}`,
        earlyPay: [],
      },
      "0x01",
      "0x02",
    ]);
    expect(toTransaction(call).data.slice(0, 10)).toMatch(/^0x[0-9a-f]{8}$/);
  });
});

import { burnIntentTypedData, gatewayBalances, gatewayDepositCalls, gatewayDomain, gatewayMintCall, submitBurnIntents } from "../src/index.js";

describe("Gateway", () => {
  const A = (n: string) => `0x${n.repeat(40)}` as const;
  const params = {
    source: { domain: 26, wallet: A("1"), token: A("2") },
    destination: { domain: 6, minter: A("3"), token: A("4") },
    depositor: A("5"),
    recipient: A("6"),
    value: 1_000_000n,
    maxFee: 2_010_000n,
    salt: `0x${"ab".repeat(32)}` as const,
  };

  it("builds Circle's BurnIntent with bytes32-padded addresses, the Vault as recipient and no chainId in the domain", () => {
    const t = burnIntentTypedData(params);
    expect(t.domain).toEqual({ name: "GatewayWallet", version: "1" });
    expect(t.types.TransferSpec.map((f) => f.name)).toEqual([
      "version", "sourceDomain", "destinationDomain", "sourceContract", "destinationContract", "sourceToken",
      "destinationToken", "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller", "value", "salt", "hookData",
    ]);
    expect(t.message.spec.destinationRecipient).toBe(`0x${"0".repeat(24)}${"6".repeat(40)}`);
    expect(t.message.spec.sourceSigner).toBe(t.message.spec.sourceDepositor);
    expect(t.message.maxBlockHeight).toBe((1n << 256n) - 1n);
  });

  it("parses balances at full precision and picks contracts from Gateway's own info", async () => {
    const fetcher = (async () => ({ ok: true, json: async () => ({ balances: [{ domain: 26, balance: "3.500001" }] }) })) as unknown as typeof fetch;
    expect(await gatewayBalances("testnet", A("5"), [26], fetcher)).toEqual([{ domain: 26, balance: 3_500_001n }]);
    const domains = [{ chain: "Arc", network: "Testnet", domain: 26, walletContract: { address: A("1"), supportedTokens: ["USDC"] }, minterContract: { address: A("3"), supportedTokens: ["USDC"] } }];
    expect(gatewayDomain(domains, 26).minterContract.address).toBe(A("3"));
    expect(() => gatewayDomain(domains, 99)).toThrow(/no wallet/);
  });

  it("builds deposit and mint calls, and surfaces Gateway errors", async () => {
    const [approve, deposit] = gatewayDepositCalls(A("1"), A("2"), 5n);
    expect(approve).toMatchObject({ address: A("2"), functionName: "approve", args: [A("1"), 5n] });
    expect(deposit).toMatchObject({ address: A("1"), functionName: "deposit", args: [A("2"), 5n] });
    expect(toTransaction(gatewayMintCall(A("3"), "0x01", "0x02")).data.slice(0, 10)).toBe("0x9fb01cc5");
    const failing = (async () => ({ ok: false, status: 400, text: async () => "insufficient balance" })) as unknown as typeof fetch;
    await expect(submitBurnIntents("testnet", [], failing)).rejects.toThrow(/insufficient balance/);
  });
});

describe("release notes", () => {
  it("fetches verified release notes by implementation address", () => {
    const v1Impl = "0x02bCb1288338d47e31342737772D0b32bBA3842A";
    const v2Impl = "0xA6aA3c4DB43f36b061939feF1f822E14bF06BcF8";
    const n1 = getReleaseNotes(v1Impl);
    expect(n1?.version).toBe(1);
    expect(n1?.notes).toContain("SymbolonVault release 1");

    const n2 = getReleaseNotes(v2Impl.toLowerCase());
    expect(n2?.version).toBe(2);
    expect(n2?.notes).toContain("SymbolonVault release 2");

    expect(getReleaseNotes("0x0000000000000000000000000000000000000000")).toBeUndefined();
  });
});

