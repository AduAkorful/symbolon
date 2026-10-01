import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  members,
  recurringSeries,
  seals,
  seriesInvoices,
  users,
  type Database,
} from "@symbolon/db";
import { sealDomain, signSealMessage, typedData } from "@symbolon/seal";

vi.mock("server-only", () => ({}));

import type { ComposerDraft } from "@/lib/server/compose";
import {
  cancelSeries,
  listSeries,
  prepareSeries,
  releaseDueSafe,
  submitSeries,
} from "@/lib/server/series";

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

let db: Database;
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

beforeAll(async () => {
  db = await createTestDb();
});

async function setupScenario() {
  const sealKey = privateKeyToAccount(generatePrivateKey());
  const sealAddress = sealKey.address.toLowerCase();

  const vendorUser = await db
    .insert(users)
    .values({ wallet: sealAddress })
    .returning()
    .then((r) => r[0]!);

  await db.insert(seals).values({
    address: sealAddress,
    userId: vendorUser.id,
    handle: `series-${Math.random().toString(36).slice(2, 8)}`,
    displayName: "Retainer Agency",
  });

  const business = await db
    .insert(businesses)
    .values({
      name: "Client Enterprise",
      chainId: cfg.chainId,
      vault: randAddr(),
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      stewardMode: "auto",
    })
    .returning()
    .then((r) => r[0]!);

  return { sealKey, vendorUser, business };
}

describe("Recurring Series service", () => {
  it("prepares a multi-period schedule with strictly increasing dates", async () => {
    const { vendorUser, business } = await setupScenario();

    const template: ComposerDraft = {
      client: { name: "Client Enterprise", vault: business.vault },
      currency: "USDC",
      invoiceNumber: "RET-2026",
      dueDays: 30,
      lines: [{ description: "Monthly Advisory", quantity: "1", unitPrice: "3000" }],
    };

    const start = Math.floor(Date.now() / 1000) + 86400; // starts tomorrow
    const prep = await prepareSeries(db, cfg, vendorUser, template, {
      start,
      periods: 3,
      every: "monthly",
      dueAfterDays: 30,
    });

    expect(prep.periods.length).toBe(3);
    expect(prep.periods[0]!.period).toBe(1);
    expect(prep.periods[1]!.period).toBe(2);
    expect(prep.periods[2]!.period).toBe(3);

    // Strictly increasing issue dates
    expect(prep.periods[1]!.issuedAt).toBeGreaterThan(prep.periods[0]!.issuedAt);
    expect(prep.periods[2]!.issuedAt).toBeGreaterThan(prep.periods[1]!.issuedAt);

    // Each period has valid EIP-712 typed data
    expect(prep.periods[0]!.typedData).toBeDefined();
    const parsed = JSON.parse(prep.periods[0]!.typedData);
    expect(parsed.primaryType).toBe("Invoice");
  });

  it("submits a pre-signed series and stores all periods", async () => {
    const { sealKey, vendorUser, business } = await setupScenario();

    const template: ComposerDraft = {
      client: { name: "Client Enterprise", vault: business.vault },
      currency: "USDC",
      invoiceNumber: "Q-RETAINER",
      dueDays: 14,
      lines: [{ description: "Sprint Retainer", quantity: "1", unitPrice: "1500" }],
    };

    const start = Math.floor(Date.now() / 1000) + 86400;
    const prep = await prepareSeries(db, cfg, vendorUser, template, {
      start,
      periods: 2,
      every: { days: 14 },
      dueAfterDays: 14,
    });

    // Sign each period
    const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
    const signatures: string[] = [];
    for (const p of prep.periods) {
      const sig = await sealKey.signTypedData(JSON.parse(p.typedData));
      signatures.push(sig);
    }

    const sub = await submitSeries(db, cfg, vendorUser, {
      periods: prep.periods,
      signatures,
      businessId: business.id,
      description: "Q4 Sprint Retainer",
    });

    expect(sub.id).toBeDefined();
    expect(sub.periods).toBe(2);

    // Check listSeries returns this series
    const list = await listSeries(db, vendorUser);
    expect(list.length).toBeGreaterThan(0);
    const found = list.find((s) => s.id === sub.id);
    expect(found).toBeDefined();
    expect(found!.totalPeriods).toBe(2);
    expect(found!.status).toBe("active");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date((start + 15 * 86400) * 1000));
    try {
      expect(await releaseDueSafe(db, cfg, { businessId: business.id })).toHaveLength(2);
      expect(await releaseDueSafe(db, cfg, { businessId: business.id })).toHaveLength(0);
      expect((await listSeries(db, vendorUser)).find(s => s.id === sub.id)!.releasedPeriods).toBe(2);
    } finally { vi.useRealTimers(); }

  });

  it("allows vendor to cancel an active recurring series", async () => {
    const { sealKey, vendorUser, business } = await setupScenario();

    const template: ComposerDraft = {
      client: { name: "Client Enterprise", vault: business.vault },
      currency: "USDC",
      invoiceNumber: "CANCEL-ME",
      dueDays: 30,
      lines: [{ description: "Monthly Services", quantity: "1", unitPrice: "1000" }],
    };

    const start = Math.floor(Date.now() / 1000) + 86400 * 2;
    const prep = await prepareSeries(db, cfg, vendorUser, template, {
      start,
      periods: 2,
      every: "monthly",
      dueAfterDays: 30,
    });

    const signatures: string[] = [];
    for (const p of prep.periods) {
      const sig = await sealKey.signTypedData(JSON.parse(p.typedData));
      signatures.push(sig);
    }

    const sub = await submitSeries(db, cfg, vendorUser, {
      periods: prep.periods,
      signatures,
      businessId: business.id,
    });

    const cancelRes = await cancelSeries(db, vendorUser, sub.id);
    expect(cancelRes.cancelled).toBe(true);

    const list = await listSeries(db, vendorUser);
    const found = list.find((s) => s.id === sub.id);
    expect(found!.status).toBe("cancelled");
  });
});
