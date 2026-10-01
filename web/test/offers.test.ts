import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  earlyPayOffers,
  invoices,
  members,
  seals,
  users,
  notifications,
  type Database,
} from "@symbolon/db";
import {
  completeTotals,
  encodeSealedInvoice,
  sealDomain,
  sealInvoice,
  signSealMessage,
  typedData,
} from "@symbolon/seal";

vi.mock("server-only", () => ({}));

vi.mock("@symbolon/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/chain")>();
  return {
    ...actual,
    symbolonContracts: () => ({
      ledger: {
        read: {
          status: vi.fn().mockResolvedValue({
            credited: 0n,
            cancelled: false,
          }),
        },
      },
    }),
  };
});

import { AuthError } from "@/lib/server/errors";
import {
  declineOffer,
  listOffersForInvoice,
  prepareOffer,
  submitOffer,
  suggestedDiscount,
  withdrawOffer,
} from "@/lib/server/offers";

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const mockClient = {
  getCode: vi.fn().mockResolvedValue(undefined),
} as unknown as PublicClient;

let db: Database;
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

beforeAll(async () => {
  db = await createTestDb();
});

async function setupTestScenario() {
  const sealKey = privateKeyToAccount(generatePrivateKey());
  const sealAddress = sealKey.address.toLowerCase();

  // 1. Create vendor user and seal
  const vendorUser = await db
    .insert(users)
    .values({ wallet: sealAddress })
    .returning()
    .then((r) => r[0]!);

  await db.insert(seals).values({
    address: sealAddress,
    userId: vendorUser.id,
    handle: `vendor-${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Test Vendor Inc",
  });

  // 2. Create business and member
  const businessUser = await db
    .insert(users)
    .values({ wallet: randAddr() })
    .returning()
    .then((r) => r[0]!);

  const business = await db
    .insert(businesses)
    .values({
      name: "Payer Client Corp",
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      stewardMode: "auto",
    })
    .returning()
    .then((r) => r[0]!);

  await db.insert(members).values({
    businessId: business.id,
    userId: businessUser.id,
    role: "owner",
  });

  // 3. Create sealed invoice
  const futureDue = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days in future
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealAddress,
    vendor: { name: "Test Vendor Inc" },
    payer: { name: "Payer Client Corp", vault: business.vault },
    invoiceNumber: `INV-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    issuedAt: Math.floor(Date.now() / 1000),
    dueDate: futureDue,
    currency: {
      chainId: cfg.chainId,
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      symbol: "USDC",
      decimals: 6,
    },
    lineItems: [{ description: "Dev Services", quantity: "1", unitPrice: "5000" }],
    taxes: [],
    discounts: [],
    payout: { address: randAddr(), domain: 0 },
    earlyPay: [],
    attachments: [],
  } as never);

  const { sealed, fingerprint } = await sealInvoice({
    signer: sealKey,
    chainId: cfg.chainId,
    ledger: cfg.deployment.contracts.invoiceLedger,
    document,
  });

  const [inv] = await db
    .insert(invoices)
    .values({
      fingerprint: fingerprint.toLowerCase(),
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger.toLowerCase(),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      seal: sealAddress,
      businessId: business.id,
      invoiceNumber: document.invoiceNumber,
      payerRef: business.vault!,
      envelope: encodeSealedInvoice(sealed),
      total: 5000000000n,
      credited: 0n,
      dueDate: new Date(futureDue * 1000),
      status: "verified",
      source: "link",
    })
    .returning();

  return { sealKey, vendorUser, businessUser, business, invoice: inv!, fingerprint: fingerprint.toLowerCase(), futureDue };
}

describe("Early Pay offers service", () => {
  it("suggestedDiscount returns null when vendor has no history, and past rate when settled", async () => {
    const { invoice, sealKey } = await setupTestScenario();
    const sealAddress = sealKey.address.toLowerCase();

    // No past history
    const initial = await suggestedDiscount(db, sealAddress);
    expect(initial).toBeNull();

    // Seed a past settled offer
    await db.insert(earlyPayOffers).values({
      fingerprint: invoice.fingerprint,
      discountBps: 175,
      validUntil: new Date(Date.now() + 86400 * 1000),
      signature: "0x1234",
      status: "open",
    });
    // Mark invoice as paid
    await db.update(invoices).set({ status: "paid" });

    const withHistory = await suggestedDiscount(db, sealAddress);
    expect(withHistory).not.toBeNull();
    expect(withHistory!.discountBps).toBe(175);
    expect(withHistory!.discountPercent).toBe("1.75");
  });

  it("prepares an EIP-712 early pay offer for a vendor", async () => {
    const { vendorUser, fingerprint } = await setupTestScenario();

    const prepared = await prepareOffer(
      db,
      mockClient,
      cfg,
      vendorUser,
      fingerprint,
      200, // 2%
      86400, // 24 hours
    );

    expect(prepared.fingerprint).toBe(fingerprint);
    expect(prepared.discountBps).toBe(200);
    expect(prepared.typedData).toBeDefined();
    expect(JSON.parse(prepared.typedData).primaryType).toBe("EarlyPayOffer");
  });

  it("rejects offer preparation if user is not the invoice vendor", async () => {
    const { businessUser, fingerprint } = await setupTestScenario();

    await expect(
      prepareOffer(
        db,
        mockClient,
        cfg,
        businessUser,
        fingerprint,
        200,
        86400,
      ),
    ).rejects.toThrow(AuthError);
  });

  it("submits a vendor-signed early pay offer and verifies signature", async () => {
    const { sealKey, vendorUser, fingerprint } = await setupTestScenario();

    const prepared = await prepareOffer(
      db,
      mockClient,
      cfg,
      vendorUser,
      fingerprint,
      150,
      86400 * 3,
    );

    // Vendor signs with their seal key using typedData
    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "EarlyPayOffer", {
        fingerprint: fingerprint as `0x${string}`,
        discountBps: 150,
        validUntil: BigInt(prepared.validUntil),
      }),
    );

    const res = await submitOffer(db, mockClient, cfg, vendorUser, {
      fingerprint,
      discountBps: 150,
      validUntil: prepared.validUntil,
      signature,
    });

    expect(res.id).toBeDefined();

    const list = await listOffersForInvoice(db, fingerprint);
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe("open");
    expect(list[0]!.discountBps).toBe(150);
  });

  it("prevents submitting a second active offer while one is already pending", async () => {
    const { sealKey, vendorUser, fingerprint } = await setupTestScenario();

    const prepared = await prepareOffer(
      db,
      mockClient,
      cfg,
      vendorUser,
      fingerprint,
      100,
      86400,
    );

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "EarlyPayOffer", {
        fingerprint: fingerprint as `0x${string}`,
        discountBps: 100,
        validUntil: BigInt(prepared.validUntil),
      }),
    );

    await submitOffer(db, mockClient, cfg, vendorUser, {
      fingerprint,
      discountBps: 100,
      validUntil: prepared.validUntil,
      signature,
    });

    // Submitting again should throw 400
    await expect(
      submitOffer(db, mockClient, cfg, vendorUser, {
        fingerprint,
        discountBps: 200,
        validUntil: prepared.validUntil,
        signature,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it("allows the vendor to withdraw an active offer", async () => {
    const { sealKey, vendorUser, fingerprint } = await setupTestScenario();

    const prepared = await prepareOffer(
      db,
      mockClient,
      cfg,
      vendorUser,
      fingerprint,
      250,
      86400,
    );

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "EarlyPayOffer", {
        fingerprint: fingerprint as `0x${string}`,
        discountBps: 250,
        validUntil: BigInt(prepared.validUntil),
      }),
    );

    const submitted = await submitOffer(db, mockClient, cfg, vendorUser, {
      fingerprint,
      discountBps: 250,
      validUntil: prepared.validUntil,
      signature,
    });

    const withdrawRes = await withdrawOffer(db, vendorUser, submitted.id);
    expect(withdrawRes.withdrawn).toBe(true);

    const list = await listOffersForInvoice(db, fingerprint);
    expect(list[0]!.status).toBe("withdrawn");
  });

  it("allows business owner or approver to decline an early pay offer", async () => {
    const { sealKey, vendorUser, businessUser, business, fingerprint } = await setupTestScenario();

    const prepared = await prepareOffer(
      db,
      mockClient,
      cfg,
      vendorUser,
      fingerprint,
      180,
      86400,
    );

    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signature = await signSealMessage(
      sealKey,
      typedData(domain, "EarlyPayOffer", {
        fingerprint: fingerprint as `0x${string}`,
        discountBps: 180,
        validUntil: BigInt(prepared.validUntil),
      }),
    );

    const submitted = await submitOffer(db, mockClient, cfg, vendorUser, {
      fingerprint,
      discountBps: 180,
      validUntil: prepared.validUntil,
      signature,
    });

    const declineRes = await declineOffer(db, businessUser, business.id, submitted.id);
    expect(declineRes.declined).toBe(true);

    const list = await listOffersForInvoice(db, fingerprint);
    expect(list[0]!.status).toBe("declined");
    const notices = await db.select().from(notifications);
    expect(notices.filter((n) => n.subject === fingerprint)).toEqual([expect.objectContaining({ userId: vendorUser.id, kind: "offer_declined" })]);
  });
  it("accepts a counter only with a new Seal signature over its exact discount and expiry", async () => {
    const { sealKey, vendorUser, fingerprint } = await setupTestScenario();
    const validity = Math.floor(Date.now() / 1000) + 3600;
    const [counter] = await db.insert(earlyPayOffers).values({ fingerprint, discountBps: 200, validUntil: new Date(validity * 1000), status: "countered" }).returning();
    const prepared = await prepareOffer(db, mockClient, cfg, vendorUser, fingerprint, 200, 86400, counter!.id);
    expect(prepared.validUntil).toBe(validity);
    const signature = await signSealMessage(sealKey, typedData(sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger), "EarlyPayOffer", { fingerprint: fingerprint as `0x${string}`, discountBps: 200, validUntil: BigInt(validity) }));
    await expect(submitOffer(db, mockClient, cfg, vendorUser, { fingerprint, discountBps: 201, validUntil: validity, signature, counterId: counter!.id })).rejects.toThrow("Counter terms");
    await submitOffer(db, mockClient, cfg, vendorUser, { fingerprint, discountBps: 200, validUntil: validity, signature, counterId: counter!.id });
    const listed = await listOffersForInvoice(db, fingerprint);
    expect(listed.filter((o) => o.status === "open")).toHaveLength(1);
    expect(listed.find((o) => o.id === counter!.id)?.status).toBe("declined");
  });
});
