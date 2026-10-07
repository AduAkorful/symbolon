import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, payees, unsignedBills, users } from "@symbolon/db";

vi.mock("server-only", () => ({}));

import { loadNavCounts } from "@/lib/server/nav-counts";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const deployment = getDeployment(arcTestnet.id);
const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let n = 0;
const hash = () => `0x${(++n).toString(16).padStart(64, "0")}`;

async function invoiceFor(businessId: string, seal: string, status: "received" | "verified" | "held" | "awaiting_approval" | "paid" | "cancelled") {
  await db.insert(invoices).values({
    businessId,
    fingerprint: hash(),
    chainId: arcTestnet.id,
    ledger: deployment.contracts.invoiceLedger.toLowerCase(),
    seal,
    payerRef: hash(),
    source: "link",
    dueDate: new Date(),
    token: deployment.tokens.usdc.toLowerCase(),
    invoiceNumber: `N-${n}`,
    envelope: "{}",
    total: 1_000_000n,
    status,
  });
}

describe("navigation counts are the same on every page (B5)", () => {
  it("counts approvals waiting, and inbox items from vendors not yet verified plus open unsigned bills", async () => {
    const [biz] = await db.insert(businesses).values({ name: "Counts", chainId: arcTestnet.id }).returning();
    const known = addr();
    const stranger = addr();
    await db.insert(payees).values({ businessId: biz!.id, seal: known, status: "verified", verificationMethod: "invitation", verifiedAt: new Date() });
    await invoiceFor(biz!.id, known, "awaiting_approval"); // a verified vendor: needs approval, not inbox attention
    await invoiceFor(biz!.id, known, "paid");
    await invoiceFor(biz!.id, stranger, "verified"); // unknown vendor, open: inbox
    await invoiceFor(biz!.id, stranger, "awaiting_approval"); // unknown vendor, open: inbox, and an approval
    await invoiceFor(biz!.id, stranger, "cancelled"); // finished: neither
    const [uploader] = await db.insert(users).values({ wallet: addr() }).returning();
    await db.insert(unsignedBills).values([
      { businessId: biz!.id, uploadedBy: uploader!.id, fileName: "a.pdf", fileSha256: hash(), extraction: {}, assessment: {}, status: "open" },
      { businessId: biz!.id, uploadedBy: uploader!.id, fileName: "b.pdf", fileSha256: hash(), extraction: {}, assessment: {}, status: "dismissed" },
    ]);
    expect(await loadNavCounts(db, biz!.id)).toEqual({ inbox: 3, approvals: 2 });
  });

  it("never counts another business's invoices", async () => {
    const [mine, theirs] = await db.insert(businesses).values([{ name: "Mine", chainId: arcTestnet.id }, { name: "Theirs", chainId: arcTestnet.id }]).returning();
    await invoiceFor(theirs!.id, addr(), "awaiting_approval");
    expect(await loadNavCounts(db, mine!.id)).toEqual({ inbox: 0, approvals: 0 });
  });
});
