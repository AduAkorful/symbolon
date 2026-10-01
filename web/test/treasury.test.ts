import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeEventTopics, getAddress, parseAbiItem, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  invoices,
  members,
  purchaseOrders,
  queuedChanges,
  seals,
  users,
} from "@symbolon/db";
import { eq } from "drizzle-orm";

const chainState = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
  getVaultState: vi.fn(),
  getBudget: vi.fn(),
  reserveStatus: vi.fn(),
  previewDepositData: vi.fn(),
  subscriptionLimitRemaining: vi.fn(),
  todayTimestamp: vi.fn(),
  previewRedeemData: vi.fn(),
  redemptionLimitRemaining: vi.fn(),
  getTransactionReceipt: vi.fn(),
  oracleLatestRoundData: vi.fn(),
  oracleGetRoundData: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({
    lens: {
      read: {
        getVaultState: chainState.getVaultState,
        getBudget: chainState.getBudget,
        reserveStatus: chainState.reserveStatus,
      },
    },
    teller: {
      read: {
        todayTimestamp: chainState.todayTimestamp,
        subscriptionLimitRemaining: chainState.subscriptionLimitRemaining,
        redemptionLimitRemaining: chainState.redemptionLimitRemaining,
        previewDepositData: chainState.previewDepositData,
        previewRedeemData: chainState.previewRedeemData,
      },
    },
  }),
  previewSubscribe: async (_c: any, _v: any, assets: bigint) => ({
    out: assets * 95n / 100n,
    fee: 0n,
    price: 1_000_000_000_000_000_000n,
    limitRemaining: 100_000_000_000n,
  }),
  previewRedeem: async (_c: any, _v: any, shares: bigint) => ({
    out: shares * 105n / 100n,
    fee: 0n,
    price: 1_000_000_000_000_000_000n,
    limitRemaining: 100_000_000_000n,
  }),
  reserveYield: async () => ({
    bps: 320,
    fromPrice: 1_000_000_000_000_000_000n,
    toPrice: 1_032_000_000_000_000_000n,
    fromTime: 1000n,
    toTime: 1000n + 365n * 86400n,
  }),
}));

import {
  loadTreasury,
  prepareFund,
  prepareRedeem,
  prepareSubscribe,
  prepareWithdraw,
  recordConversion,
  recordReserveMove,
  recordWithdraw,
} from "@/lib/server/treasury";
import { setBufferDays, setEarlyPay } from "@/lib/server/settings";
import { loadAhead } from "@/lib/server/home";
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
const randHash = () => ("0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")).toLowerCase();

async function setupBusiness(name = "Acme Treasury Test") {
  const [u] = await db.insert(users).values({ wallet: randAddr() }).returning();
  const [b] = await db
    .insert(businesses)
    .values({
      name,
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      bufferDays: 30,
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
  return { user: u!, business: b! };
}

describe("Treasury Service", () => {
  let mockClient: PublicClient;

  beforeEach(() => {
    vi.clearAllMocks();

    chainState.getBlockNumber.mockResolvedValue(64_060_500n);
    chainState.readContract.mockImplementation(async ({ functionName, address }: any) => {
      if (functionName === "decimals") return 6;
      if (functionName === "balanceOf") {
        if (address.toLowerCase() === cfg.deployment.tokens.usdc.toLowerCase()) {
          return 50_000_000_000n; // 50,000 USDC
        }
        if (address.toLowerCase() === cfg.deployment.tokens.eurc.toLowerCase()) {
          return 1_000_000_000n; // 1,000 EURC
        }
      }
      return 0n;
    });

    chainState.getVaultState.mockResolvedValue({
      paused: false,
      steward: randAddr(),
      owner: randAddr(),
    });

    chainState.getBudget.mockResolvedValue({
      exists: true,
      periodLength: 86400n * 30n,
      periodIndex: BigInt(Math.floor(Date.now() / 1000 / (86400 * 30))),
      cap: 100_000_000_000n, // 100k
      spent: 25_000_000_000n, // 25k
    });

    chainState.reserveStatus.mockResolvedValue({
      usycTeller: randAddr(),
      usyc: randAddr(),
      entitled: true,
      cash: 50_000_000_000n,
      shares: 20_000_000_000n,
      reserveValue: 20_000_000_000n,
      policy: {
        enabled: true,
        maxReserveBps: 5000,
        minOperating: 10_000_000_000n,
      },
    });

    mockClient = {
      getBlockNumber: chainState.getBlockNumber,
      readContract: chainState.readContract,
      getTransactionReceipt: chainState.getTransactionReceipt,
    } as unknown as PublicClient;
  });

  it("enforces member access for loadTreasury", async () => {
    const { business } = await setupBusiness();
    const outsider = { id: crypto.randomUUID() };

    await expect(
      loadTreasury(db, mockClient, cfg.deployment, business.id, outsider),
    ).rejects.toThrow(AuthError);
  });

  it("loads complete treasury state and detects shortfalls", async () => {
    const { user, business } = await setupBusiness();

    // Insert a seal and an unpaid EURC invoice exceeding the 1,000 EURC balance
    const sealAddr = randAddr();
    await db.insert(seals).values({
      address: sealAddr,
      handle: "eur-vendor",
      displayName: "Euro Vendor",
      userId: user.id,
    });

    const dueDate = new Date(Date.now() + 5 * 86400 * 1000);
    await db.insert(invoices).values({
      fingerprint: randHash(),
      chainId: cfg.chainId,
      ledger: randAddr(),
      seal: sealAddr,
      businessId: business.id,
      payerRef: randHash(),
      invoiceNumber: "EUR-001",
      token: cfg.deployment.tokens.eurc,
      total: 3_500_000_000n, // 3,500 EURC
      credited: 0n,
      dueDate,
      envelope: "{}",
      status: "verified",
      source: "upload",
    });

    const res = await loadTreasury(db, mockClient, cfg.deployment, business.id, user);

    expect(res.vault).toBe(getAddress(business.vault!));
    expect(res.balances.usdc?.amount).toBe("50000");
    expect(res.balances.eurc?.amount).toBe("1000");
    expect(res.budget?.cap).toBe("100000");
    expect(res.budget?.spent).toBe("25000");
    expect(res.reserve.available).toBe(true);
    expect(res.reserve.entitled).toBe(true);
    expect(res.reserve.yieldBps).toBe(320);

    // Shortfall check
    expect(res.shortfalls).toHaveLength(1);
    expect(res.shortfalls[0]?.tokenSymbol).toBe("EURC");
    expect(res.shortfalls[0]?.short).toBe("2500"); // 3500 - 1000 = 2500
    expect(res.shortfalls[0]?.invoices[0]?.invoiceNumber).toBe("EUR-001");
  });

  it("failed cash and reserve reads cannot manufacture forecast or reserve facts", async () => {
    const { user, business } = await setupBusiness();
    chainState.readContract.mockRejectedValue(new Error("offline"));
    chainState.reserveStatus.mockRejectedValue(new Error("offline"));
    const result = await loadTreasury(db, mockClient, cfg.deployment, business.id, user);
    expect(result.forecast.days).toEqual([]);
    expect(result.forecast.runwayStatement).toMatch(/unavailable/i);
    expect(result.operatingSplit).toBeNull();
    expect(result.reserve.readAvailable).toBe(false);
  });

  it("home Ahead failed balances remain unavailable instead of zero", async () => {
    const {user,business}=await setupBusiness();
    chainState.readContract.mockRejectedValue(new Error("offline"));
    const result=await loadAhead(db,mockClient,cfg,user,business.id);
    expect(result.runwayStatement).toMatch(/unavailable/i);
    expect(result.shortfalls).toEqual([]);
  });

  it("coverage respects EURC and the selected buffer", async () => {
    const { user, business } = await setupBusiness();
    await db.update(businesses).set({ bufferDays: 7 }).where(eq(businesses.id, business.id));
    await db.insert(invoices).values({ fingerprint: randHash(), chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger,
      seal: randAddr(), businessId: business.id, payerRef: randHash(), invoiceNumber: "Buffer EURC", token: cfg.deployment.tokens.eurc,
      total: 2_000_000_000n, dueDate: new Date(Date.now() + 5 * 86400000), envelope: "{}", status: "verified", source: "link" });
    const result = await loadTreasury(db, mockClient, cfg.deployment, business.id, user);
    expect(result.forecast.runwayStatement).toMatch(/EURC/);
    expect(result.forecast.runwayStatement).not.toMatch(/covers everything/);
    expect(result.shortfalls).toHaveLength(1);
    await db.update(businesses).set({ bufferDays: 2 }).where(eq(businesses.id, business.id));
    expect((await loadTreasury(db, mockClient, cfg.deployment, business.id, user)).shortfalls).toHaveLength(0);
  });

  describe("Settings (Early Pay & Buffer)", () => {
    it("updates Early Pay settings with decision recording", async () => {
      const { user, business } = await setupBusiness();

      const res = await setEarlyPay(db, user, business.id, {
        enabled: true,
        minSpreadBps: 400,
        cashCapBps: 2500,
      });

      expect(res.ok).toBe(true);
      expect(res.earlyPay.enabled).toBe(true);
      expect(res.earlyPay.minSpreadBps).toBe(400);

      // Verify business row updated
      const [updated] = await db.select().from(businesses).where(eq(businesses.id, business.id));
      expect(updated?.earlyPay).toEqual({ enabled: true, minSpreadBps: 400, cashCapBps: 2500 });

      // Verify decision row inserted
      const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
      expect(decs.some((d) => d.kind === "early_pay_changed")).toBe(true);
    });

    it("rejects invalid Early Pay bps values", async () => {
      const { user, business } = await setupBusiness();

      await expect(
        setEarlyPay(db, user, business.id, {
          enabled: true,
          minSpreadBps: -50,
          cashCapBps: 2500,
        }),
      ).rejects.toThrow(/between 0 and 100%/);

      await expect(
        setEarlyPay(db, user, business.id, {
          enabled: true,
          minSpreadBps: 400,
          cashCapBps: 15_000,
        }),
      ).rejects.toThrow(/between 0 and 100%/);
    });

    it("updates buffer days with decision recording", async () => {
      const { user, business } = await setupBusiness();

      const res = await setBufferDays(db, user, business.id, 45);
      expect(res.ok).toBe(true);
      expect(res.bufferDays).toBe(45);

      const [updated] = await db.select().from(businesses).where(eq(businesses.id, business.id));
      expect(updated?.bufferDays).toBe(45);

      const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
      expect(decs.some((d) => d.kind === "buffer_changed")).toBe(true);
    });

    it("rejects buffer days outside 1..90", async () => {
      const { user, business } = await setupBusiness();

      await expect(setBufferDays(db, user, business.id, 0)).rejects.toThrow(/between 1 and 90/);
      await expect(setBufferDays(db, user, business.id, 91)).rejects.toThrow(/between 1 and 90/);
    });
  });

  describe("Withdrawals", () => {
    it("prepares withdrawal strictly to owner wallet", async () => {
      const { user, business } = await setupBusiness();

      const prep = await prepareWithdraw(
        db,
        cfg,
        user,
        business.id,
        mockClient,
        "USDC",
        "1000",
      );

      expect(prep.destination).toBe(getAddress(user.wallet!));
      expect(prep.amount).toBe("1000000000"); // 1,000 * 10^6
      expect(prep.to).toBe(getAddress(business.vault!));
    });

    it("rejects withdrawal exceeding Vault balance", async () => {
      const { user, business } = await setupBusiness();

      await expect(
        prepareWithdraw(
          db,
          cfg,
          user,
          business.id,
          mockClient,
          "USDC",
          "60000", // Vault has 50k
        ),
      ).rejects.toThrow(/exceeds Vault's USDC balance/);
    });

    it("records withdrawal from valid transaction receipt", async () => {
      const { user, business } = await setupBusiness();
      const txHash = randHash();

      // Mock receipt with Withdrawn event
      const withdrawnAbi = parseAbiItem("event Withdrawn(address indexed token, address indexed to, uint256 amount)");
      const topics = encodeEventTopics({
        abi: [withdrawnAbi],
        eventName: "Withdrawn",
        args: {
          token: getAddress(cfg.deployment.tokens.usdc),
          to: getAddress(user.wallet!),
        },
      });

      chainState.getTransactionReceipt.mockResolvedValue({
        status: "success",
        logs: [
          {
            address: getAddress(business.vault!),
            topics,
            data: "0x000000000000000000000000000000000000000000000000000000003b9aca00", // 1,000 * 10^6
          },
        ],
      });

      const res = await recordWithdraw(db, cfg, user, business.id, mockClient, txHash, "Manual test withdrawal");
      expect(res.ok).toBe(true);

      const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
      const withDec = decs.find((d) => d.kind === "withdrawn");
      expect(withDec).toBeDefined();
      expect(withDec?.txHash).toBe(txHash.toLowerCase());
    });
  });

  describe("Funding & Reserve Operations", () => {
    it("prepares funding transfers for USDC and EURC", async () => {
      const { user, business } = await setupBusiness();

      const fundUsdc = await prepareFund(db, cfg, user, business.id, "250", "USDC");
      expect(fundUsdc.to).toBe(cfg.deployment.tokens.usdc);
      expect(fundUsdc.amount).toBe("250000000");

      const fundEurc = await prepareFund(db, cfg, user, business.id, "150", "EURC");
      expect(fundEurc.to).toBe(cfg.deployment.tokens.eurc);
      expect(fundEurc.amount).toBe("150000000");
    });

    it("prepares reserve subscription with preview and decision hash", async () => {
      const { user, business } = await setupBusiness();

      const prep = await prepareSubscribe(db, cfg, user, business.id, mockClient, "5000");
      expect(prep.assets).toBe("5000000000");
      expect(prep.decisionHash).toMatch(/^0x[0-9a-f]{64}$/);

      // Verify decision was recorded
      const [dec] = await db.select().from(decisions).where(eq(decisions.hash, prep.decisionHash));
      expect(dec).toBeDefined();
      expect(dec?.kind).toBe("sweep");
    });

    it("prepares reserve redemption with preview and decision hash", async () => {
      const { user, business } = await setupBusiness();

      const prep = await prepareRedeem(db, cfg, user, business.id, mockClient, "1000");
      expect(prep.shares).toBe("1000000000");
      expect(prep.decisionHash).toMatch(/^0x[0-9a-f]{64}$/);

      const [dec] = await db.select().from(decisions).where(eq(decisions.hash, prep.decisionHash));
      expect(dec).toBeDefined();
      expect(dec?.kind).toBe("redeem");
    });

    it("records reserve move from event receipt", async () => {
      const { user, business } = await setupBusiness();
      const txHash = randHash();
      const decisionHash = randHash();

      // Seed decision row
      await db.insert(decisions).values({
        businessId: business.id,
        kind: "sweep",
        subject: "treasury:reserve",
        record: { test: true },
        hash: decisionHash,
      });

      const subAbi = parseAbiItem("event ReserveSubscribed(address indexed caller, uint256 assets, uint256 shares, bytes32 decisionHash)");
      const topics = encodeEventTopics({
        abi: [subAbi],
        eventName: "ReserveSubscribed",
        args: {
          caller: getAddress(user.wallet!),
        },
      });

      chainState.getTransactionReceipt.mockResolvedValue({
        status: "success",
        logs: [
          {
            address: getAddress(business.vault!),
            topics,
            data:
              "0x000000000000000000000000000000000000000000000000000000012a05f200" + // assets
              "0x000000000000000000000000000000000000000000000000000000012a05f200".slice(2) + // shares
              decisionHash.slice(2),
          },
        ],
      });

      const res = await recordReserveMove(db, cfg, user, business.id, mockClient, txHash);
      expect(res.ok).toBe(true);
      expect(res.event).toBe("ReserveSubscribed");

      const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
      const settled = decs.find((d) => d.txHash === txHash.toLowerCase());
      expect(settled).toBeDefined();
      expect(settled?.supersedes).toBeDefined();
    });
  });

  describe("EURC Conversion Recording", () => {
    it("rejects a successful unrelated swap receipt with no gained EURC", async () => {
      const {user,business}=await setupBusiness();
      const owner=getAddress(user.wallet!);
      const vault=getAddress(business.vault!);
      const swapTx=randHash(),transferTx=randHash();
      const abi=parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
      chainState.getTransactionReceipt.mockImplementation(async ({hash}: {hash:Hex}) => hash.toLowerCase()===swapTx.toLowerCase()
        ? {status:"success",from:owner,logs:[]}
        : {status:"success",from:owner,logs:[{address:cfg.deployment.tokens.eurc,
          topics:encodeEventTopics({abi:[abi],eventName:"Transfer",args:{from:owner,to:vault}}),
          data:`0x${(1000000n).toString(16).padStart(64,"0")}`}]} );
      await expect(recordConversion(db,cfg,user,business.id,mockClient,{swapTxHash:swapTx,transferTxHash:transferTx})).rejects.toThrow(/gain/);
    });

    it("verifies receipts on chain and records conversion decision", async () => {
      const { user, business } = await setupBusiness();
      const swapTx = randHash();
      const transferTx = randHash();
      const vault = getAddress(business.vault!);
      const owner = getAddress(user.wallet!);

      const transferAbi = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
      const topics = encodeEventTopics({
        abi: [transferAbi],
        eventName: "Transfer",
        args: {
          from: owner,
          to: vault,
        },
      });

      chainState.getTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => {
        if (hash.toLowerCase() === swapTx.toLowerCase()) {
          return { status: "success", from: owner, logs: [{address:getAddress(cfg.deployment.tokens.eurc),
            topics:encodeEventTopics({abi:[transferAbi],eventName:"Transfer",args:{from:getAddress(randAddr()),to:owner}}),
            data:`0x${(500_000_000n).toString(16).padStart(64,"0")}`}] };
        }
        if (hash.toLowerCase() === transferTx.toLowerCase()) {
          return {
            status: "success",
            from: owner,
            logs: [
              {
                address: getAddress(cfg.deployment.tokens.eurc),
                topics,
                data: "0x000000000000000000000000000000000000000000000000000000001dcd6500", // 500 * 10^6 EURC
              },
            ],
          };
        }
        throw new Error("Unknown tx");
      });

      const res = await recordConversion(db, cfg, user, business.id, mockClient, {
        swapTxHash: swapTx,
        transferTxHash: transferTx,
        rate: "0.82",
      });

      expect(res.ok).toBe(true);
      expect(res.amountTransferred).toBe("500000000");

      const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
      const convDec = decs.find((d) => d.kind === "eurc_conversion");
      expect(convDec).toBeDefined();
      expect(convDec?.txHash).toBe(transferTx.toLowerCase());
    });
  });

  describe("Home Ahead Summary (T14)", () => {
    it("computes upcoming invoices, shortfalls, and truthful runway statement", async () => {
      const { user, business } = await setupBusiness();

      const sealAddr = randAddr();
      await db.insert(seals).values({
        address: sealAddr,
        handle: "supplier-ahead",
        displayName: "Ahead Supplier",
        userId: user.id,
      });

      const due = new Date(Date.now() + 2 * 86400 * 1000);
      await db.insert(invoices).values({
        fingerprint: randHash(),
        chainId: cfg.chainId,
        ledger: randAddr(),
        seal: sealAddr,
        businessId: business.id,
        payerRef: randHash(),
        invoiceNumber: "INV-AHEAD-1",
        token: cfg.deployment.tokens.usdc,
        total: 10_000_000_000n, // 10k USDC
        credited: 0n,
        dueDate: due,
        envelope: "{}",
        status: "verified",
        source: "upload",
      });

      const ahead = await loadAhead(db, mockClient, cfg, user, business.id);

      expect(ahead.upcomingInvoices).toHaveLength(1);
      expect(ahead.upcomingInvoices[0]?.invoiceNumber).toBe("INV-AHEAD-1");
      expect(ahead.upcomingInvoices[0]?.amountFormatted).toBe("10000.000000");
      expect(ahead.runwayStatement).toContain("USDC and EURC cash cover recorded bills");
    });

    it("isolates ahead summary across multiple businesses", async () => {
      const { user: userA, business: bizA } = await setupBusiness("Biz A");
      const { user: userB, business: bizB } = await setupBusiness("Biz B");

      // User A cannot read Biz B ahead
      await expect(loadAhead(db, mockClient, cfg, userA, bizB.id)).rejects.toThrow(AuthError);
    });
  });
});
