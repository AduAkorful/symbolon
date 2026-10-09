import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import {
  businesses,
  decisions,
  createTestDb,
  members,
  notifications,
  payees,
  seals,
  users,
  vendorRequests,
  type Database,
} from "@symbolon/db";
import { sealDomain, signSealMessage, typedData } from "@symbolon/seal";

import { chainDouble, chainState } from "./setup-shared";

import { and, eq } from "drizzle-orm";

import { AuthError } from "@/lib/server/errors";
import {
  listVendorRequests,
  prepareConfirmPayoutChange,
  prepareVendorPayoutChange,
  recordConfirmPayoutChange,
  recordCancelPayoutChange,
  rejectPayoutChangeRequest,
  submitVendorPayoutChange,
} from "@/lib/server/payout-change";

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const mockClient = {
  getCode: vi.fn().mockResolvedValue(undefined),
  waitForTransactionReceipt: chainState.waitForTransactionReceipt,
  getTransaction: chainState.getTransaction,
} as unknown as PublicClient;

let db: Database;
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  chainDouble.enabled = true;
  chainState.getPayee.mockReset().mockResolvedValue({
    exists: true,
    lastChangeNonce: 100n,
    payout: randAddr(),
    payoutDomain: 0,
    activeAt: 1000n,
  });
  chainState.waitForTransactionReceipt.mockReset();
});

async function setupScenario() {
  const sealKey = privateKeyToAccount(generatePrivateKey());
  const sealAddress = sealKey.address.toLowerCase();

  // 1. Vendor user and seal
  const vendorUser = await db
    .insert(users)
    .values({ wallet: sealAddress })
    .returning()
    .then((r) => r[0]!);

  await db.insert(seals).values({
    address: sealAddress,
    userId: vendorUser.id,
    handle: `vendor-${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Multi-Client Vendor",
  });

  // 2. Business 1 (owner user 1)
  const ownerUser1 = await db
    .insert(users)
    .values({ wallet: randAddr() })
    .returning()
    .then((r) => r[0]!);

  const business1 = await db
    .insert(businesses)
    .values({
      name: "Business Alpha",
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      stewardMode: "auto",
    })
    .returning()
    .then((r) => r[0]!);

  await db.insert(members).values({
    businessId: business1.id,
    userId: ownerUser1.id,
    role: "owner",
  });

  // Payee link in DB
  await db.insert(payees).values({
    businessId: business1.id,
    seal: sealAddress,
    status: "verified",
    verificationMethod: "known_contact",
    verifiedAt: new Date(),
  });

  // 3. Business 2 (owner user 2)
  const ownerUser2 = await db
    .insert(users)
    .values({ wallet: randAddr() })
    .returning()
    .then((r) => r[0]!);

  const business2 = await db
    .insert(businesses)
    .values({
      name: "Business Beta",
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      stewardMode: "auto",
    })
    .returning()
    .then((r) => r[0]!);

  await db.insert(members).values({
    businessId: business2.id,
    userId: ownerUser2.id,
    role: "owner",
  });

  await db.insert(payees).values({
    businessId: business2.id,
    seal: sealAddress,
    status: "verified",
    verificationMethod: "known_contact",
    verifiedAt: new Date(),
  });

  return { sealKey, vendorUser, business1, ownerUser1, business2, ownerUser2 };
}

describe("Payout Change service", () => {
  it.each(["confirm", "cancel"] as const)("records concurrent %s receipt retries once with one vendor notice", async (action) => {
    const { sealKey, vendorUser, business1, ownerUser1 } = await setupScenario();
    const newPayout = getAddress(randAddr());
    const message = { seal: sealKey.address, newPayout, payoutDomain: 0, nonce: "123" };
    const signature = "0x01" as Hex;
    const [request] = await db.insert(vendorRequests).values({
      businessId: business1.id, seal: sealKey.address.toLowerCase(), kind: "payout_change",
      message, signature, status: action === "confirm" ? "pending" : "confirmed",
    }).returning();
    const txHash = `0x${"ab".repeat(32)}` as Hex;
    chainState.getTransaction.mockResolvedValue({ input: action === "confirm"
      ? encodeFunctionData({ abi: symbolonVaultAbi, functionName: "confirmPayoutChange", args: [{ ...message, nonce: 123n }, signature] })
      : encodeFunctionData({ abi: symbolonVaultAbi, functionName: "cancelPayoutChange", args: [sealKey.address] }) });
    chainState.waitForTransactionReceipt.mockResolvedValue({
      status: "success", to: business1.vault, blockNumber: 200n, logs: [{ address: business1.vault,
        topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: action === "confirm" ? "PayoutChangeConfirmed" : "PayoutChangeCancelled", args: { seal: sealKey.address } }),
        data: action === "confirm" ? encodeAbiParameters([{ type: "address" }, { type: "uint32" }, { type: "uint64" }], [newPayout, 0, 1000n]) : "0x",
      }],
    });
    // Both callers complete the outside-transaction checks before either may record.
    let readCount = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    chainState.getPayee.mockImplementation(async (_args, opts) => {
      if (++readCount === (action === "confirm" ? 2 : 4)) release();
      await barrier;
      return { lastChangeNonce: 123n, pendingPayout: newPayout, pendingDomain: 0,
        pendingActiveAt: action === "confirm" || opts?.blockNumber ? 1000n : 0n };
    });
    const record = action === "confirm" ? recordConfirmPayoutChange : recordCancelPayoutChange;
    const results = await Promise.all([
      record(db, mockClient, ownerUser1, business1.id, { requestId: request!.id, txHash }),
      record(db, mockClient, ownerUser1, business1.id, { requestId: request!.id, txHash: `0x${"AB".repeat(32)}` }),
    ]);
    expect(results[0]).toEqual(results[1]);
    const kind = action === "confirm" ? "payout_change_confirmed" : "payout_change_cancelled";
    const recorded = await db.select().from(decisions).where(and(eq(decisions.businessId, business1.id), eq(decisions.kind, kind)));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.txHash).toBe(txHash);
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, vendorUser.id), eq(notifications.kind, kind)))).toHaveLength(1);
    const [other] = await db.insert(vendorRequests).values({ businessId: business1.id, seal: sealKey.address.toLowerCase(),
      kind: "payout_change", message, signature: "0x02", status: action === "confirm" ? "pending" : "confirmed" }).returning();
    await expect(record(db, mockClient, ownerUser1, business1.id, { requestId: other!.id, txHash })).rejects.toThrow(/another payout request/);
    expect(await db.select().from(decisions).where(and(eq(decisions.businessId, business1.id), eq(decisions.kind, kind)))).toHaveLength(1);
  });
  it("prepares a multi-business payout change typed data for vendor", async () => {
    const { vendorUser } = await setupScenario();
    const newPayout = randAddr();

    const prepared = await prepareVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
    });

    expect(prepared.newPayout.toLowerCase()).toBe(newPayout.toLowerCase());
    expect(prepared.businesses.length).toBe(2);
    expect(BigInt(prepared.nonce)).toBeGreaterThan(100n);
    expect(prepared.typedData).toBeDefined();

    const parsed = JSON.parse(prepared.typedData);
    expect(parsed.primaryType).toBe("PayoutChange");
  });

  it("submits vendor payout change and fans out across multiple businesses with shared signature", async () => {
    const { sealKey, vendorUser, business1, business2 } = await setupScenario();
    const newPayout = randAddr();

    const prepared = await prepareVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
    });

    // Vendor signs the PayoutChange typed data
    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "PayoutChange", {
        seal: getAddress(sealKey.address),
        newPayout: getAddress(newPayout),
        payoutDomain: 0,
        nonce: BigInt(prepared.nonce),
      }),
    );

    const subRes = await submitVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
      nonce: prepared.nonce,
      signature,
    });

    expect(subRes.success).toBe(true);
    expect(subRes.count).toBe(2);

    // Verify both businesses have a pending vendorRequest
    const reqs1 = await listVendorRequests(db, business1.id);
    expect(reqs1.length).toBe(1);
    expect(reqs1[0]!.status).toBe("pending");
    expect(reqs1[0]!.newPayout.toLowerCase()).toBe(newPayout.toLowerCase());

    const reqs2 = await listVendorRequests(db, business2.id);
    expect(reqs2.length).toBe(1);
    expect(reqs2[0]!.status).toBe("pending");
  });

  it("allows business owner to prepare confirm transaction", async () => {
    const { sealKey, vendorUser, business1, ownerUser1 } = await setupScenario();
    const newPayout = randAddr();

    const prepared = await prepareVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
    });

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "PayoutChange", {
        seal: getAddress(sealKey.address),
        newPayout: getAddress(newPayout),
        payoutDomain: 0,
        nonce: BigInt(prepared.nonce),
      }),
    );

    const subRes = await submitVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
      nonce: prepared.nonce,
      signature,
    });

    const requestId = subRes.requestIds[0]!;

    const prepConfirm = await prepareConfirmPayoutChange(db, cfg, ownerUser1, business1.id, requestId);
    expect(prepConfirm.to.toLowerCase()).toBe(business1.vault!.toLowerCase());
    expect(prepConfirm.data).toBeDefined();
    expect(prepConfirm.data.startsWith("0x")).toBe(true);
  });

  it("records confirm payout change when receipt contains PayoutChangeConfirmed event", async () => {
    const { sealKey, vendorUser, business1, ownerUser1 } = await setupScenario();
    const newPayout = randAddr();

    const prepared = await prepareVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
    });

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "PayoutChange", {
        seal: getAddress(sealKey.address),
        newPayout: getAddress(newPayout),
        payoutDomain: 0,
        nonce: BigInt(prepared.nonce),
      }),
    );

    const subRes = await submitVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
      nonce: prepared.nonce,
      signature,
    });

    const requestId = subRes.requestIds[0]!;

    // Mock receipt with PayoutChangeConfirmed log
    const txHash = ("0x" + "b".repeat(64)) as Hex;
    chainState.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      to: business1.vault,
      blockNumber: 100n,
      logs: [
        {
          address: business1.vault,
          topics: encodeEventTopics({
            abi: symbolonVaultAbi,
            eventName: "PayoutChangeConfirmed",
            args: {
              seal: getAddress(sealKey.address),
            },
          }),
          data: encodeAbiParameters(
            [
              { type: "address", name: "newPayout" },
              { type: "uint32", name: "payoutDomain" },
              { type: "uint64", name: "activeAt" },
            ],
            [getAddress(newPayout), 0, 1000n],
          ),
        },
      ],
    });

    const input = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "confirmPayoutChange", args: [{ seal: getAddress(sealKey.address), newPayout: getAddress(newPayout), payoutDomain: 0, nonce: BigInt(prepared.nonce) }, signature] });
    chainState.getTransaction.mockResolvedValue({ input });
    chainState.getPayee.mockResolvedValue({ exists: true, lastChangeNonce: BigInt(prepared.nonce), pendingPayout: getAddress(newPayout), pendingDomain: 0, pendingActiveAt: 1000n });
    const receipt = await chainState.waitForTransactionReceipt();
    chainState.waitForTransactionReceipt.mockResolvedValueOnce({ ...receipt, to: randAddr() });
    await expect(recordConfirmPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash })).rejects.toThrow();
    const recRes = await recordConfirmPayoutChange(db, mockClient, ownerUser1, business1.id, {
      requestId,
      txHash,
    });

    expect(recRes.success).toBe(true);

    const reqs = await listVendorRequests(db, business1.id);
    expect(reqs[0]!.status).toBe("confirmed");

    // Receipt retry returns its original verified result without appending another decision.
    const beforeRetry = await db.select().from(decisions).where(eq(decisions.businessId, business1.id));
    chainState.getPayee.mockRejectedValueOnce(new Error("offline"));
    expect(await recordConfirmPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash })).toEqual(recRes);
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business1.id))).toHaveLength(beforeRetry.length);
    chainState.getPayee.mockReset();

    const cancelHash = ("0x" + "c".repeat(64)) as Hex;
    chainState.getTransaction.mockResolvedValue({ input: encodeFunctionData({ abi: symbolonVaultAbi, functionName: "cancelPayoutChange", args: [getAddress(sealKey.address)] }) });
    const cancelReceipt = { status: "success", to: business1.vault, blockNumber: 200n, logs: [{ address: business1.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "PayoutChangeCancelled", args: { seal: getAddress(sealKey.address) } }), data: "0x" }] };
    chainState.waitForTransactionReceipt.mockResolvedValue({ ...cancelReceipt, to: randAddr() });
    await expect(recordCancelPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash: cancelHash })).rejects.toThrow(/Vault/);
    chainState.waitForTransactionReceipt.mockResolvedValue(cancelReceipt);
    const prior = { lastChangeNonce: BigInt(prepared.nonce), pendingPayout: getAddress(newPayout), pendingDomain: 0, pendingActiveAt: 1000n };
    chainState.getPayee.mockResolvedValueOnce(prior).mockResolvedValueOnce({ lastChangeNonce: BigInt(prepared.nonce) + 1n, pendingActiveAt: 0n });
    await expect(recordCancelPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash: cancelHash })).rejects.toThrow(/match/);
    chainState.getPayee.mockResolvedValueOnce(prior).mockResolvedValueOnce({ lastChangeNonce: BigInt(prepared.nonce), pendingActiveAt: 0n });
    expect(await recordCancelPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash: cancelHash })).toEqual({ success: true });
    expect(await recordCancelPayoutChange(db, mockClient, ownerUser1, business1.id, { requestId, txHash: cancelHash })).toEqual({ success: true });
    expect((await listVendorRequests(db, business1.id))[0]!.status).toBe("cancelled");
  });

  it("allows business owner or approver to reject a pending payout change", async () => {
    const { sealKey, vendorUser, business1, ownerUser1 } = await setupScenario();
    const newPayout = randAddr();

    const prepared = await prepareVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
    });

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "PayoutChange", {
        seal: getAddress(sealKey.address),
        newPayout: getAddress(newPayout),
        payoutDomain: 0,
        nonce: BigInt(prepared.nonce),
      }),
    );

    const subRes = await submitVendorPayoutChange(db, mockClient, cfg, vendorUser, {
      newPayout,
      payoutDomain: 0,
      nonce: prepared.nonce,
      signature,
    });

    const requestId = subRes.requestIds[0]!;

    const rejRes = await rejectPayoutChangeRequest(db, ownerUser1, business1.id, requestId, "Suspicious request");
    expect(rejRes.success).toBe(true);

    const reqs = await listVendorRequests(db, business1.id);
    expect(reqs[0]!.status).toBe("rejected");
  });
});
