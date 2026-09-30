import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  members,
  payees,
  seals,
  users,
  vendorRequests,
  type Database,
} from "@symbolon/db";
import { sealDomain, signSealMessage, typedData } from "@symbolon/seal";

vi.mock("server-only", () => ({}));

const chainState = vi.hoisted(() => ({
  getPayee: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@symbolon/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/chain")>();
  return {
    ...actual,
    symbolonContracts: () => ({
      lens: {
        read: {
          getPayee: chainState.getPayee,
        },
      },
    }),
  };
});

import { AuthError } from "@/lib/server/errors";
import {
  listVendorRequests,
  prepareConfirmPayoutChange,
  prepareVendorPayoutChange,
  recordConfirmPayoutChange,
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
} as unknown as PublicClient;

let db: Database;
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
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

    const recRes = await recordConfirmPayoutChange(db, mockClient, ownerUser1, business1.id, {
      requestId,
      txHash,
    });

    expect(recRes.success).toBe(true);

    const reqs = await listVendorRequests(db, business1.id);
    expect(reqs[0]!.status).toBe("confirmed");
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
