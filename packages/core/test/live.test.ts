// PGlite + Arc testnet (read-only). Run with: LIVE=1 pnpm --filter @symbolon/core test
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { arcTestnet, createArcClient, getDeployment, symbolonContracts } from "@symbolon/chain";
import { businesses, chainEvents, createTestDb, decisionAnchors, decisions, invoices } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import { DEFAULT_EARLY_PAY, verifyProof, proofFor, buildTree } from "@symbolon/steward";

import { anchorDecisions, receiveInvoice, recordVault, runCycle, runSteward, syncLedger, syncVault } from "../src/index.js";
import { factoryContract } from "@symbolon/chain";

const smoke = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../contracts/deployments/smoke/5042002-${name}.json`, import.meta.url)), "utf8"));

const stranger = () => privateKeyToAccount(keccak256(stringToBytes("core.live.owner"))).address;

describe.skipIf(!process.env.LIVE)("core against Arc testnet", () => {
  const client = createArcClient(arcTestnet.id);
  const deployment = getDeployment(arcTestnet.id);
  const contracts = symbolonContracts(client, deployment);
  const ledger = { chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger };
  const { vault } = smoke("vault");

  it("links a Vault only when a Symbolon factory made it for the expected owner", async () => {
    const db = await createTestDb();
    const [biz] = await db.insert(businesses).values({ name: "Smoke", chainId: deployment.chainId }).returning();
    const release1 = JSON.parse(readFileSync(fileURLToPath(new URL("../../../contracts/deployments/releases/5042002-v1.json", import.meta.url)), "utf8"));
    const factories = [contracts.factory, factoryContract(client, { ...deployment, contracts: { ...deployment.contracts, vaultFactory: release1.VaultFactory } })];
    await expect(recordVault(db, contracts, { businessId: biz!.id, vault, expectedOwner: stranger(), factories })).rejects.toThrow(/owned by/);
    await expect(recordVault(db, contracts, { businessId: biz!.id, vault, expectedOwner: deployment.releaseOwner, factories: [contracts.factory] })).rejects.toThrow(/factory/);
    await recordVault(db, contracts, { businessId: biz!.id, vault, expectedOwner: deployment.releaseOwner, factories });
    expect((await db.select().from(businesses))[0]!.vault).toBe(vault.toLowerCase());
  }, 120_000);

  it("takes in the real smoke invoice and sync marks it paid from the ledger", async () => {
    const db = await createTestDb();
    await db.insert(businesses).values({ name: "Smoke", chainId: deployment.chainId, vault: vault.toLowerCase() });
    const { envelope, fingerprint } = smoke("invoice");
    const intake = await receiveInvoice(db, ledger, envelope, "api");
    expect(intake.status).toBe("verified");

    const report = await syncLedger(db, client, contracts, deployment);
    expect(report.events).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint));
    expect(row).toMatchObject({ status: "paid", credited: 1_000_000n });

    // the Vault's own trail: created, payee added, paid, upgrade scheduled
    const { createdBlock } = smoke("vault");
    const v = await syncVault(db, client, deployment, vault, { fromBlock: BigInt(createdBlock) - 5n });
    expect(v.events).toBeGreaterThanOrEqual(3);
    const names = (await db.select().from(chainEvents)).map((e) => e.eventName);
    expect(names).toEqual(expect.arrayContaining(["PayeeAdded", "Paid", "Settled", "UpgradeScheduled"]));

    // resumable: a second pass starts after the cursor and changes nothing
    const again = await syncLedger(db, client, contracts, deployment);
    expect(again.from).toBe(report.to + 1n);
  }, 180_000);

  it("runs the Steward in shadow mode on a live Vault and records why it holds an unknown vendor", async () => {
    const db = await createTestDb();
    const [biz] = await db
      .insert(businesses)
      .values({ name: "Smoke", chainId: deployment.chainId, vault: vault.toLowerCase(), stewardMode: "shadow" })
      .returning();
    const stranger = privateKeyToAccount(keccak256(stringToBytes("core.live.stranger")));
    const document = completeTotals({
      schema: "symbolon.invoice.v1",
      seal: stranger.address.toLowerCase(),
      vendor: { name: "Unknown vendor (test data)" },
      payer: { name: "Smoke", vault: vault.toLowerCase() },
      invoiceNumber: "LIVE-1",
      issuedAt: Math.floor(Date.now() / 1000),
      dueDate: Math.floor(Date.now() / 1000) + 30 * 86_400,
      currency: { chainId: deployment.chainId, token: deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
      lineItems: [{ description: "Test", quantity: "1", unitPrice: "1" }],
      taxes: [],
      discounts: [],
      payout: { address: stranger.address.toLowerCase(), domain: deployment.cctpDomain },
      earlyPay: [],
      attachments: [],
    });
    const { sealed } = await sealInvoice({ signer: stranger, chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger, document });
    await receiveInvoice(db, ledger, encodeSealedInvoice(sealed), "api");

    const env = { db, client, contracts, deployment, program: DEFAULT_EARLY_PAY, bufferDays: 30, reserveYieldBps: 0 };
    const [result] = await runSteward(env, biz!.id);
    expect(result!.outcome).toBe("held");
    expect(JSON.stringify(result!.record.inputs)).toMatch(/payee/);
    await runSteward(env, biz!.id);
    expect(await db.select().from(decisions)).toHaveLength(1); // unchanged decision isn't re-recorded

    const anchor = await anchorDecisions(db, biz!.id, undefined, { dryRun: true });
    expect(anchor?.count).toBe(1);
    const [stored] = await db.select().from(decisionAnchors);
    const tree = buildTree(stored!.leaves as `0x${string}`[]);
    expect(tree.root).toBe(anchor!.root);
    expect(verifyProof(proofFor(tree, 0), tree.root, stored!.leaves[0] as `0x${string}`)).toBe(true);
    expect(await anchorDecisions(db, biz!.id, undefined, { dryRun: true })).toBeUndefined();
  }, 180_000);

  it("runs a whole cycle: sync, Steward, treasury, anchoring, for every business", async () => {
    const db = await createTestDb();
    await db.insert(businesses).values({ name: "Smoke", chainId: deployment.chainId, vault: vault.toLowerCase(), stewardMode: "shadow" });
    await db.insert(businesses).values({ name: "No Vault yet", chainId: deployment.chainId });
    const report = await runCycle(
      { db, client, contracts, deployment, program: DEFAULT_EARLY_PAY, bufferDays: 30, reserveYieldBps: 0 },
      { anchor: true },
    );
    expect(report.businesses).toHaveLength(1);
    expect(report.businesses[0]!.error).toBeUndefined();
    expect(report.businesses[0]!.treasury).toBe("none"); // release-1 Vault: no reserve yet
  }, 300_000);
});
