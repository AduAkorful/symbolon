import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, stringToHex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { symbolonVaultAbi } from "@symbolon/chain";
import { businesses, createTestDb, decisionAnchors, decisions } from "@symbolon/db";
import { type StewardWallet } from "@symbolon/steward";
import { anchorDecisions } from "../src/anchor.js";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.$client.close(); });

describe("confirmed decision anchors", () => {
  it("does not persist a batch after a failed receipt, then persists the exact successful Vault event", async () => {
    const vault = privateKeyToAccount(generatePrivateKey()).address;
    const { arcTestnet } = await import("@symbolon/chain");
    const [business] = await db.insert(businesses).values({ name: "Anchors", chainId: arcTestnet.id, vault: vault.toLowerCase() }).returning();
    await db.insert(decisions).values({ businessId: business!.id, kind: "hold", hash: keccak256(stringToHex(crypto.randomUUID())), record: {} });
    const send = vi.fn().mockResolvedValue(keccak256(stringToHex("anchor transaction")));
    const wallet = { address: vault, send } as unknown as StewardWallet;
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "reverted", to: vault, logs: [] });
    const client = { waitForTransactionReceipt } as unknown as PublicClient;
    await expect(anchorDecisions(db, business!.id, wallet, { client })).rejects.toThrow(/not confirmed/);
    expect(await db.select().from(decisionAnchors).where(eq(decisionAnchors.businessId, business!.id))).toHaveLength(0);
    const call = send.mock.calls[0]![0];
    waitForTransactionReceipt.mockResolvedValue({ status: "success", to: vault, logs: [{ address: vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "DecisionsAnchored", args: { root: call.args[0] } }), data: encodeAbiParameters([{ type: "uint256" }], [call.args[1]]) }] });
    expect(await anchorDecisions(db, business!.id, wallet, { client })).toMatchObject({ count: 1 });
    expect(await db.select().from(decisionAnchors).where(eq(decisionAnchors.businessId, business!.id))).toHaveLength(1);
  });
});
