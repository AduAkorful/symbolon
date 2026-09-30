import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, decisions, members, users } from "@symbolon/db";
import { and, eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { parseNativeFeeAmount, prepareFeeTransfer, recordFeeTransfer } from "@/lib/server/business";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const HASH = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

async function setupBusiness(role: "owner" | "approver" = "owner", steward?: string) {
  const [u] = await db.insert(users).values({ wallet: fresh().toLowerCase() }).returning();
  const stewardWallet = steward ?? fresh().toLowerCase();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Acme Fee Test",
      chainId: cfg.chainId,
      vault: fresh().toLowerCase(),
      stewardWallet,
      stewardMode: "shadow",
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role });
  return { user: u!, business: b!, stewardWallet };
}

describe("parseNativeFeeAmount", () => {
  it("parses valid decimal USDC strings into 18-decimal wei amounts", () => {
    expect(parseNativeFeeAmount("1")).toBe(1_000_000_000_000_000_000n);
    expect(parseNativeFeeAmount("0.05")).toBe(50_000_000_000_000_000n);
    expect(parseNativeFeeAmount("0.0001")).toBe(100_000_000_000_000n);
  });

  it("throws on invalid, non-positive, or empty inputs", () => {
    expect(() => parseNativeFeeAmount("")).toThrow("Enter an amount like 0.1 or 1");
    expect(() => parseNativeFeeAmount("0")).toThrow("The amount has to be more than zero.");
    expect(() => parseNativeFeeAmount("-1")).toThrow("Enter an amount like 0.1 or 1");
    expect(() => parseNativeFeeAmount("abc")).toThrow("Enter an amount like 0.1 or 1");
  });
});

describe("prepareFeeTransfer", () => {
  it("non-owner cannot prepare fee transfer (403)", async () => {
    const { business, user } = await setupBusiness("approver");
    await expect(prepareFeeTransfer(db, cfg, user, business.id, "0.5")).rejects.toThrow(
      "You don't have access to do this for this business.",
    );
  });

  it("returns prepared Call with native value targeting the recorded Steward wallet (S5)", async () => {
    const { business, user, stewardWallet } = await setupBusiness("owner");
    const res = await prepareFeeTransfer(db, cfg, user, business.id, "0.1");

    expect(res.to.toLowerCase()).toBe(stewardWallet.toLowerCase());
    expect(res.data).toBe("0x");
    expect(res.value).toBe(`0x${(100_000_000_000_000_000n).toString(16)}`);
    expect(res.amount).toBe(100_000_000_000_000_000n.toString());
  });
});

describe("recordFeeTransfer", () => {
  it("rejects non-hash strings with 400", async () => {
    const { business, user } = await setupBusiness("owner");
    const mockClient = {} as unknown as PublicClient;
    await expect(recordFeeTransfer(db, mockClient, cfg, user, business.id, "not-a-hash")).rejects.toThrow(
      "That isn't a transaction hash.",
    );
  });

  it("refuses if transaction was not sent from owner wallet (403)", async () => {
    const { business, user, stewardWallet } = await setupBusiness("owner");
    const txHash = HASH(1);

    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: getAddress(stewardWallet),
        from: fresh(), // Different from owner
      }),
    } as unknown as PublicClient;

    await expect(recordFeeTransfer(db, mockClient, cfg, user, business.id, txHash)).rejects.toThrow(
      "That transaction was not sent from your wallet.",
    );
  });

  it("refuses if transaction was not sent to steward wallet (409)", async () => {
    const { business, user } = await setupBusiness("owner");
    const txHash = HASH(2);

    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: fresh(), // Different from steward
        from: getAddress(user.wallet!),
      }),
    } as unknown as PublicClient;

    await expect(recordFeeTransfer(db, mockClient, cfg, user, business.id, txHash)).rejects.toThrow(
      "That transaction was not sent to this business's Steward wallet.",
    );
  });

  it("records confirmed fee transfer, appends decision, and returns updated balance (S5)", async () => {
    const { business, user, stewardWallet } = await setupBusiness("owner");
    const txHash = HASH(3);
    const amountWei = 250_000_000_000_000_000n; // 0.25 USDC

    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: getAddress(stewardWallet),
        from: getAddress(user.wallet!),
      }),
      getTransaction: vi.fn().mockResolvedValue({
        value: amountWei,
      }),
      getBalance: vi.fn().mockResolvedValue(amountWei),
    } as unknown as PublicClient;

    const res = await recordFeeTransfer(db, mockClient, cfg, user, business.id, txHash);
    expect(res.ok).toBe(true);
    expect(res.txHash).toBe(txHash.toLowerCase());
    expect(res.balance).toBe(amountWei.toString());

    // Verify decision recorded
    const [dec] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.businessId, business.id), eq(decisions.kind, "steward_fees_funded")));
    expect(dec).toBeDefined();
    expect((dec?.record as Record<string, unknown>).inputs).toMatchObject({
      amount: amountWei.toString(),
      stewardWallet,
      txHash: txHash.toLowerCase(),
    });
  });
});
