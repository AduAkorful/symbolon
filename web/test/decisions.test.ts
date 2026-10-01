import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  decisionAnchors,
  members,
  users,
} from "@symbolon/db";
import { buildTree, hashRecord, proofFor, toRecordValue, type DecisionRecord } from "@symbolon/steward";
import { encodeAbiParameters, encodeEventTopics, type Hex, type PublicClient } from "viem";

vi.mock("server-only", () => ({}));

import { listDecisions, loadDecision } from "@/lib/server/decisions";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

async function setupBusiness() {
  const [u] = await db.insert(users).values({ wallet: randAddr() }).returning();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Acme Decision Test",
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
  return { user: u!, business: b! };
}

describe("Decisions Service", () => {
  it("loads a decision record and confirms hash matches", async () => {
    const { user, business } = await setupBusiness();

    const record: DecisionRecord = {
      version: 1,
      kind: "pay",
      business: business.id,
      at: new Date().toISOString(),
      mode: "auto",
      inputs: {
        paid: "100000000",
        invoice: {
          fingerprint: "0x1234567890abcdef",
          vendor: "Studio Ana",
          amount: "100.00",
          dueDate: "2026-10-01",
        },
      },
      options: [
        {
          id: "pay_full",
          description: "Pay remaining invoice credit",
          amount: "100000000",
          discountBps: 0,
          approved: true,
          reasons: ["Within auto-pay limit"],
        },
      ],
      rule: "within policy auto-pay threshold",
      outcome: "proposed",
    };

    const { hash } = hashRecord(record);

    const [row] = await db
      .insert(decisions)
      .values({
        businessId: business.id,
        hash,
        subject: "0x1234567890abcdef",
        kind: "pay",
        record: toRecordValue(record) as never,
        createdAt: new Date(),
      })
      .returning();

    const client = {} as PublicClient;
    const view = await loadDecision(db, client, cfg, user, business.id, row!.id);

    expect(view).not.toBeNull();
    expect(view!.hashMatches).toBe(true);
    expect(view!.hash).toBe(hash);
    expect(view!.sentence).toContain("Proposed paying");
    expect(view!.kind).toBe("pay");
  });

  it("detects a tampered decision row where stored hash does not match content", async () => {
    const { user, business } = await setupBusiness();

    const record: DecisionRecord = {
      version: 1,
      kind: "steward_run",
      business: business.id,
      at: new Date().toISOString(),
      mode: "shadow",
      inputs: {},
      options: [],
      rule: "shadow comparison",
      outcome: "request_approval",
    };

    // Store a bogus/tampered hash
    const fakeHash = "0x9999999999999999999999999999999999999999999999999999999999999999";

    const [row] = await db
      .insert(decisions)
      .values({
        businessId: business.id,
        hash: fakeHash,
        subject: null,
        kind: "steward_run",
        record: toRecordValue(record) as never,
        createdAt: new Date(),
      })
      .returning();

    const client = {} as PublicClient;
    const view = await loadDecision(db, client, cfg, user, business.id, row!.id);

    expect(view).not.toBeNull();
    expect(view!.hashMatches).toBe(false);
  });

  it("enforces business isolation when loading decisions", async () => {
    const b1 = await setupBusiness();
    const b2 = await setupBusiness();

    const [row] = await db
      .insert(decisions)
      .values({
        businessId: b1.business.id,
        hash: "0xaaaa",
        kind: "steward_run",
        record: {
          version: 1,
          kind: "steward_run",
          business: b1.business.id,
          at: new Date().toISOString(),
          mode: "shadow",
          inputs: {},
          options: [],
          rule: "test",
          outcome: "held",
        } as never,
        createdAt: new Date(),
      })
      .returning();

    const client = {} as PublicClient;
    // User of business 2 tries to access business 1's decision
    await expect(
      loadDecision(db, client, cfg, b2.user, b1.business.id, row!.id)
    ).rejects.toThrow();
  });

  it("verifies Merkle proof when decision is anchored", async () => {
    const { user, business } = await setupBusiness();

    const record: DecisionRecord = {
      version: 1,
      kind: "steward_run",
      business: business.id,
      at: new Date().toISOString(),
      mode: "auto",
      inputs: {},
      options: [],
      rule: "auto run",
      outcome: "request_approval",
    };

    const { hash } = hashRecord(record);
    const leaf = hash as Hex;
    const otherLeaf = "0x8888888888888888888888888888888888888888888888888888888888888888" as Hex;
    const leaves = [leaf, otherLeaf];
    const tree = buildTree(leaves);

    // Create anchor batch
    await db
      .insert(decisionAnchors)
      .values({
        root: tree.root,
        businessId: business.id,
        count: leaves.length,
        leaves: leaves as never,
        txHash: "0x123abc",
        createdAt: new Date(),
      });

    const [decRow] = await db
      .insert(decisions)
      .values({
        businessId: business.id,
        hash: leaf,
        subject: null,
        kind: "steward_run",
        record: toRecordValue(record) as never,
        createdAt: new Date(),
      })
      .returning();

    const client = {
      getTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", to: business.vault, blockNumber: 100n, logs: [{ address: business.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "DecisionsAnchored", args: { root: tree.root } }), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(leaves.length)]) }] }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1000n }),
    } as unknown as PublicClient;


    const view = await loadDecision(db, client, cfg, user, business.id, decRow!.id);
    expect(view).not.toBeNull();
    expect(view!.anchor.status).toBe("anchored");
    expect(view!.anchor.root).toBe(tree.root);
    expect(view!.anchor.proofValid).toBe(true);
    expect(view!.anchor.proof).toBeDefined();
  });
});
