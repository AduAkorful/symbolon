import { beforeAll, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, members, users } from "@symbolon/db";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { eq } from "drizzle-orm";
import { AuthError } from "@/lib/server/errors";
import { duplicateCandidates, listInbox, loadInvoiceDetail } from "@/lib/server/inbox";

vi.mock("server-only", () => ({}));

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const client = {} as PublicClient;
const wallet = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const hash = (byte: string) => `0x${byte.repeat(64)}`;

async function user() {
  return (await db.insert(users).values({ wallet: wallet() }).returning())[0]!;
}

async function business(name: string, userId: string, role: "owner" | "viewer" = "owner") {
  const [b] = await db.insert(businesses).values({ name, chainId: cfg.chainId }).returning();
  await db.insert(members).values({ businessId: b!.id, userId, role });
  return b!;
}

describe("business inbox isolation", () => {
  it("does not expose another business's invoice or detail", async () => {
    const owner = await user();
    const otherOwner = await user();
    const mine = await business("Mine", owner.id);
    const theirs = await business("Theirs", otherOwner.id);
    const fingerprint = hash("a");
    await db.insert(invoices).values({
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: wallet(),
      businessId: theirs.id,
      payerRef: hash("b"),
      invoiceNumber: "0001",
      token: cfg.deployment.tokens.usdc,
      total: 1n,
      dueDate: new Date("2026-10-01T00:00:00Z"),
      envelope: "not-for-the-other-business",
      source: "link",
    });

    expect(await listInbox(db, client, cfg, owner, mine.id)).toEqual([]);
    expect(await loadInvoiceDetail(db, client, cfg, owner, mine.id, fingerprint)).toBeNull();
  });

  it("only considers the current business's invoices as duplicate candidates", async () => {
    const owner = await user();
    const otherOwner = await user();
    const mine = await business("Duplicate mine", owner.id);
    const theirs = await business("Duplicate theirs", otherOwner.id);
    const seal = wallet();
    await db.insert(invoices).values([
      { fingerprint: hash("c"), chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger, seal, businessId: mine.id, payerRef: hash("d"), invoiceNumber: "SAME-1", token: cfg.deployment.tokens.usdc, total: 1n, dueDate: new Date("2026-10-01T00:00:00Z"), envelope: "mine", source: "link" },
      { fingerprint: hash("e"), chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger, seal, businessId: theirs.id, payerRef: hash("f"), invoiceNumber: "SAME-1", token: cfg.deployment.tokens.usdc, total: 1n, dueDate: new Date("2026-10-01T00:00:00Z"), envelope: "theirs", source: "link" },
    ]);

    const candidates = await duplicateCandidates(db, mine.id, seal, hash("a"));
    expect(candidates.map((row) => row.fingerprint)).toEqual([hash("c")]);
  });

  it("gives a non-member the same forbidden result for an existing business", async () => {
    const owner = await user();
    const stranger = await user();
    const b = await business("Private", owner.id);
    const error = await listInbox(db, client, cfg, stranger, b.id).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(403);
  });

  it("does not mistake a business with no Vault for an empty onchain result", async () => {
    const owner = await user();
    const b = await business("No vault", owner.id, "viewer");
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.vault).toBeNull();
    expect(await listInbox(db, client, cfg, owner, b.id)).toEqual([]);
  });
});
