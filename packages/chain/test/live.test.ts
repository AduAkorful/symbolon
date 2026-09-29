// Read-only checks against Arc testnet. Run with: pnpm --filter @symbolon/chain test:live
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAbiItem, getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  arcTestnet,
  createArcClient,
  erc20Abi,
  getDeployment,
  invoiceLedgerAbi,
  invoiceStatus,
  scanLogs,
  simulateCall,
  symbolonContracts,
  toTransaction,
  vaultCall,
} from "../src/index.js";

const smoke = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/deployments/smoke/5042002-${name}.json`, import.meta.url)), "utf8"));

describe.skipIf(!process.env.LIVE)("Arc testnet (live, read-only)", () => {
  const client = createArcClient(arcTestnet.id);
  const d = getDeployment(arcTestnet.id);
  const c = symbolonContracts(client, d);
  const { vault, payout } = smoke("vault");
  const { fingerprint } = smoke("invoice") as { fingerprint: Hex };

  it("reaches the deployed ledger and registry", async () => {
    expect(await client.getChainId()).toBe(arcTestnet.id);
    expect(await c.ledger.read.localDomain()).toBe(d.cctpDomain);
    const [latest, version] = await c.registry.read.latest();
    expect(latest).toBe(d.contracts.vaultImplementation);
    expect(Number(version)).toBe(d.releaseVersion);
  });

  it("reads the smoke Vault through the lens", async () => {
    const state = await c.lens.read.getVaultState([vault]);
    expect(state.owner).toBe(d.releaseOwner);
    expect(state.accountingDecimals).toBe(6);
    expect(await c.factory.read.isVault([vault])).toBe(false); // made by release 1's factory
  });

  it("reports the smoke invoice as fully paid", async () => {
    const status = await invoiceStatus(c, fingerprint);
    expect(status).toMatchObject({ seen: true, paid: true, remaining: 0n, total: 1_000_000n });
  });

  it("simulates on the node and surfaces the contract's error", async () => {
    // an owner-only call from a stranger must revert in simulation, before anything is signed
    const call = vaultCall(vault, "pause", []);
    await expect(simulateCall(client, call, "0x000000000000000000000000000000000000dEaD")).rejects.toThrow(/OwnableUnauthorizedAccount/);
    expect(toTransaction(call).to).toBe(getAddress(vault));
  });

  it("finds the smoke settlement exactly once, and one USDC transfer to the payout (not Arc's system duplicate)", async () => {
    const settled = getAbiItem({ abi: invoiceLedgerAbi, name: "Settled" });
    const { logs } = await scanLogs(client, { address: d.contracts.invoiceLedger, events: [settled], fromBlock: d.startBlock });
    const ours = logs.filter((l) => l.args.fingerprint === fingerprint);
    expect(ours).toHaveLength(1);
    expect(ours[0]!.args.paid).toBe(1_000_000n);

    const transfer = getAbiItem({ abi: erc20Abi, name: "Transfer" });
    const block = ours[0]!.blockNumber;
    const { logs: transfers } = await scanLogs(client, { address: d.tokens.usdc, events: [transfer], fromBlock: block, toBlock: block });
    expect(transfers.filter((t) => t.args.to === getAddress(payout))).toHaveLength(1);
  }, 120_000);
});

import { checkInvoice, cctpFees, reserveYield } from "../src/index.js";

describe.skipIf(!process.env.LIVE)("verify page, reserve yield, CCTP (live)", () => {
  const client = createArcClient(arcTestnet.id);
  const d = getDeployment(arcTestnet.id);
  const c = symbolonContracts(client, d);

  it("shows the smoke invoice as genuine and paid, with when and by whom", async () => {
    const { envelope, fingerprint } = smoke("invoice");
    const check = await checkInvoice(client, c, d, envelope);
    expect(check.verification.ok).toBe(true);
    expect(check.status?.paid).toBe(true);
    expect(check.settlements).toHaveLength(1);
    expect(check.settlements[0]!.paid).toBe(1_000_000n);
    expect(check.settlements[0]!.payer).toBe(getAddress(smoke("vault").vault));
    expect(check.settlements[0]!.timestamp).toBeGreaterThan(1_790_000_000n);
    expect(fingerprint).toBe(check.verification.fingerprint);

    const tampered = (envelope as string).replace("Deployment smoke test", "Deployment smoke tesT");
    const bad = await checkInvoice(client, c, d, tampered);
    expect(bad.verification.ok).toBe(false);
  }, 120_000);

  it("derives the reserve yield from the USYC oracle's own history", async () => {
    const y = await reserveYield(client, d.usycTeller!);
    expect(y.bps).toBeGreaterThan(0);
    expect(y.bps).toBeLessThan(2_000);
    expect(y.toTime).toBeGreaterThan(y.fromTime);
  });

  it("reads Circle's CCTP fees for a payout from Arc", async () => {
    const fees = await cctpFees(d.cctpDomain, 0, "testnet");
    expect(fees.map((f) => f.finalityThreshold)).toContain(2_000);
  });
});
