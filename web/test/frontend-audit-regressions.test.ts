import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, keccak256, stringToHex, zeroAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { approvals, businesses, createTestDb, decisionAnchors, decisions, invoices, members, payees, queuedChanges, screenings, users } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealDomain, sealInvoice, signSealMessage, typedData } from "@symbolon/seal";
import { hashRecord, type VaultFacts } from "@symbolon/steward";
import { recordDeliveryOutcome } from "@symbolon/core";
import { and, eq } from "drizzle-orm";

// All repaired audit assertions run normally; failures reopen the corresponding finding.
vi.mock("server-only", () => ({}));
const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookies.has(name) ? { name, value: cookies.get(name)! } : undefined }),
}));
vi.mock("@/lib/server/db", () => ({ getDb: async () => db }));
vi.mock("@/lib/server/config", () => ({ getConfig: () => ({ ...cfg, appOrigin: ORIGIN, production: false }) }));
vi.mock("@/lib/server/chain", () => ({ getClient: () => activeClient }));
const chain = vi.hoisted(() => ({ remaining: vi.fn(), ledgerState: vi.fn(), cash: vi.fn(), state: vi.fn(), facts: vi.fn(), scanLogs: vi.fn(), invoiceStatus: vi.fn(), isApprover: vi.fn(), approverBudgetCount: vi.fn(), isRequester: vi.fn() }));
vi.mock("@symbolon/chain", async (original) => ({
  ...(await original<typeof import("@symbolon/chain")>()),
  scanLogs: chain.scanLogs, invoiceStatus: chain.invoiceStatus,
  symbolonContracts: () => ({
    lens: { read: {
      getVaultState: chain.state, isApprover: chain.isApprover, approverBudgetCount: chain.approverBudgetCount, isRequester: chain.isRequester,
      getPayee: async () => (await chain.facts()).payee,
      reserveStatus: vi.fn().mockResolvedValue({ policy: { enabled: false }, entitled: false, usycTeller: zeroAddress }),
    } },
    ledger: { read: { remaining: chain.remaining, status: chain.ledgerState } },
    token: () => ({ read: { balanceOf: chain.cash } }),
  }),
}));
vi.mock("@symbolon/core", async (original) => ({
  ...(await original<typeof import("@symbolon/core")>()), readVaultFacts: chain.facts,
}));
vi.mock("@/lib/server/steward-model", () => ({ getStewardModel: () => null }));

import { prepareApproval, preparePayNow, rejectApproval, submitApproval } from "@/lib/server/approvals";
import { removeMember, setMemberRole } from "@/lib/server/team";
import { anchorState } from "@/lib/server/anchoring";
import { loadDecision } from "@/lib/server/decisions";
import { loadReceipt } from "@/lib/server/receipt";
import { applyQueuedChange, recordQueuedChange } from "@/lib/client/queued-actions";
import { createSession } from "@/lib/server/session";
import { POST as approvalsPost } from "@/app/api/business/[id]/approvals/route";
import { GET as queuedChangesGet, POST as queuedChangesPost } from "@/app/api/business/[id]/queued-changes/route";

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const ORIGIN = "http://localhost:3000";
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const randomAddress = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
let db: Awaited<ReturnType<typeof createTestDb>>;
let activeClient: PublicClient;
beforeAll(async () => { db = await createTestDb(); });
beforeEach(() => {
  cookies.clear();
  chain.remaining.mockReset().mockResolvedValue(100_000_000n); chain.state.mockReset(); chain.facts.mockReset();
  chain.ledgerState.mockReset().mockResolvedValue({ seen: true, cancelled: false });
  chain.cash.mockReset().mockResolvedValue(250_000_000n);
  chain.scanLogs.mockReset(); chain.invoiceStatus.mockReset();
  chain.approverBudgetCount.mockReset().mockResolvedValue(0n);
  chain.isApprover.mockReset().mockResolvedValue(true); chain.isRequester.mockReset().mockResolvedValue(false);
});

async function fixture(status: "awaiting_approval" | "held" = "awaiting_approval", blocked = false, early = false) {
  const userKey = privateKeyToAccount(generatePrivateKey());
  const [user] = await db.insert(users).values({ wallet: userKey.address.toLowerCase() }).returning();
  const vault = randomAddress();
  const [business] = await db.insert(businesses).values({ name: "Audit business", chainId: cfg.chainId, vault, stewardMode: "auto" }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: user!.id, role: "owner" });
  const vendor = privateKeyToAccount(generatePrivateKey());
  const payout = randomAddress();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const document = completeTotals({
    schema: "symbolon.invoice.v1", seal: vendor.address.toLowerCase(), vendor: { name: "Audit vendor" },
    payer: { name: "Audit business", vault }, invoiceNumber: "AUDIT-1", issuedAt: Number(now - 200n), dueDate: Number(early ? now + 30n * 86400n : now - 100n),
    currency: { chainId: cfg.chainId, token: cfg.deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
    lineItems: [{ description: "Consulting", quantity: "1", unitPrice: "100" }], taxes: [], discounts: [],
    payout: { address: payout, domain: 26 }, earlyPay: early ? [{ discountBps: 200, payBy: Number(now + 86400n) }] : [], attachments: [],
  } as never);
  const sealed = await sealInvoice({ signer: vendor, chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger, document });
  const row = {
    businessId: business!.id, fingerprint: sealed.fingerprint, chainId: cfg.chainId,
    ledger: cfg.deployment.contracts.invoiceLedger.toLowerCase(), seal: vendor.address.toLowerCase(),
    payerRef: sealed.invoice.payerRef, invoiceNumber: document.invoiceNumber, token: cfg.deployment.tokens.usdc.toLowerCase(),
    total: 100_000_000n, credited: 0n, issuedAt: new Date(Number(now - 200n) * 1000), dueDate: new Date(document.dueDate * 1000),
    envelope: encodeSealedInvoice(sealed.sealed), source: "link" as const, status,
    holdSource: status === "held" ? "human" as const : null,
  };
  await db.insert(invoices).values(row);
  if (blocked) await db.insert(payees).values({ businessId: business!.id, seal: row.seal, status: "blocked" });
  chain.state.mockResolvedValue({ owner: getAddress(user!.wallet!), paused: false });
  const facts: VaultFacts = {
    now, paused: false, localDomain: 26,
    policy: { perTxCap: 1_000_000_000n, autoPayLimit: 1_000_000_000n, ownerThreshold: 1_000_000_000n,
      newVendorMinPaid: 0, screeningMaxAge: 0n, newPayeeDelay: 0n, changeCooldown: 0n, looseningDelay: 0n, maxBridgeFee: 0n },
    isSupportedToken: () => true,
    payee: { exists: true, paidCount: 5, payout: getAddress(payout), payoutDomain: 26, activeAt: now - 1n, retireAt: 0n,
      lastChangeNonce: 0n, pendingPayout: getAddress(payout), pendingDomain: 26, pendingActiveAt: 0n,
      risk: 0, screenedAt: now, spendPeriod: 0n, spentInPeriod: 0n,
      terms: { budget: ZERO32, requirePo: false, requireDelivery: false, monthlyCap: 1_000_000_000n } },
    budget: () => ({ exists: true, periodLength: 86400n, periodIndex: now / 86400n, cap: 1_000_000_000n, spent: 0n }),
    deliveryConfirmed: false, purchaseOrder: undefined,
  };
  chain.facts.mockResolvedValue(facts);
  const client = { simulateContract: vi.fn().mockResolvedValue({}), getBlock: vi.fn().mockResolvedValue({ timestamp: now }), getCode: vi.fn().mockResolvedValue(undefined) } as unknown as PublicClient;
  activeClient = client;
  return { user: user!, userKey, business: business!, fingerprint: sealed.fingerprint, client, row, facts };
}

async function signIn(userId: string) {
  const { token } = await createSession(db, userId, "privy");
  cookies.set("symbolon_session", token);
}

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

function approvalRequest(fingerprint: string) {
  return new Request(`${ORIGIN}/api/business/audit/approvals`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ action: "prepare-approval", fingerprint }),
  });
}

describe("2026-10-01 frontend audit regressions and Batch A repairs", () => {
  it("control: prepares a payable invoice with valid signed envelope and live facts", async () => {
    const f = await fixture();
    const prepared = await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.ok).toBe(true);
  });
  it("allows approval for an unseen, unpaid invoice instead of treating remaining=0 as settled", async () => {
    const f = await fixture();
    chain.remaining.mockResolvedValue(0n); // InvoiceLedger.remaining for seen=false
    chain.ledgerState.mockResolvedValue({ seen: false, cancelled: false });
    const prepared = await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.credit).toBe(f.row.total.toString());
  });
  it("allows pay-now for an unseen, unpaid invoice", async () => {
    const f = await fixture();
    chain.remaining.mockResolvedValue(0n);
    chain.ledgerState.mockResolvedValue({ seen: false, cancelled: false });
    const prepared = await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.ok).toBe(true);
  });
  it("returns a JSON-serializable prepared approval through the API", async () => {
    const f = await fixture();
    const prepared = await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(() => Response.json(prepared)).not.toThrow();
  });
  it("returns the exact prepared signing JSON through the real authenticated POST route", async () => {
    const f = await fixture();
    await signIn(f.user.id);
    const response = await approvalsPost(approvalRequest(f.fingerprint), routeContext(f.business.id));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.credit).toBe(f.row.total.toString());
    expect(payload.typedData).toEqual(JSON.parse(payload.typedDataJson));
  });
  it("refuses approval preparation from another business or a viewer through the actual POST route", async () => {
    const f = await fixture();
    const [outsider] = await db.insert(users).values({ wallet: randomAddress() }).returning();
    await signIn(outsider!.id);
    expect((await approvalsPost(approvalRequest(f.fingerprint), routeContext(f.business.id))).status).toBe(403);
    await db.insert(members).values({ businessId: f.business.id, userId: outsider!.id, role: "viewer" });
    expect((await approvalsPost(approvalRequest(f.fingerprint), routeContext(f.business.id))).status).toBe(403);
  });
  it("allows a member's normal browser GET without an Origin header", async () => {
    const f = await fixture();
    await signIn(f.user.id);
    const response = await queuedChangesGet(new Request(`${ORIGIN}/api/business/${f.business.id}/queued-changes`), routeContext(f.business.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, changes: [] });
  });
  it("refuses another business's queued calldata to an authenticated outsider", async () => {
    const f = await fixture();
    const data = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "setBudget", args: [ZERO32, 1n, 86400n] });
    await db.insert(queuedChanges).values({
      businessId: f.business.id, kind: "set_budget", changeId: keccak256(data),
      selector: data.slice(0, 10), calldata: data, summary: { title: "Private budget change" }, eta: new Date(),
    });
    const [outsider] = await db.insert(users).values({ wallet: randomAddress() }).returning();
    await signIn(outsider!.id);
    const response = await queuedChangesGet(new Request(`${ORIGIN}/api/business/${f.business.id}/queued-changes`, { headers: { origin: ORIGIN } }), routeContext(f.business.id));
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("changes");
  });
  it("client queue actions use the server Vault target and record both apply and cancel through the actual route", async () => {
    const f = await fixture(); await signIn(f.user.id);
    const calldata = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "setAutoUpdate", args: [true] });
    const id = keccak256(calldata);
    await db.insert(queuedChanges).values({ businessId: f.business.id, kind: "set_auto_update", changeId: id, selector: calldata.slice(0, 10), calldata, summary: {}, eta: new Date(), status: "queued" });
    const response = await queuedChangesGet(new Request(`${ORIGIN}/api/business/${f.business.id}/queued-changes`), routeContext(f.business.id));
    const { changes } = await response.json() as { changes: { to: string; calldata: string }[] };
    const hash = keccak256(stringToHex("apply queue"));
    const receipt = { status: "success", to: f.business.vault, logs: [{ address: f.business.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "AutoUpdateSet" }), data: encodeAbiParameters([{ type: "bool" }], [true]) }] };
    Object.assign(f.client, { getTransactionReceipt: vi.fn().mockResolvedValue(receipt), getTransaction: vi.fn().mockResolvedValue({ input: calldata }) });
    const send = vi.fn().mockResolvedValue(hash);
    const fetch = vi.fn(async (url: string, init: RequestInit) => queuedChangesPost(new Request(`${ORIGIN}${url}`, { ...init, headers: { "content-type": "application/json", origin: ORIGIN } }), routeContext(f.business.id)));
    vi.stubGlobal("fetch", fetch);
    try {
      expect(await applyQueuedChange(f.business.id, changes[0]!, send)).toMatchObject({ ok: true, status: "applied" });
      expect(send).toHaveBeenCalledWith({ to: getAddress(f.business.vault!), data: calldata });
      expect(send.mock.calls[0]![0].to.toLowerCase()).not.toBe(f.user.wallet);
      await expect(applyQueuedChange(f.business.id, { to: null, calldata }, send)).rejects.toThrow(/unavailable/);
      await db.update(queuedChanges).set({ status: "queued" }).where(eq(queuedChanges.changeId, id));
      Object.assign(f.client, { getTransactionReceipt: vi.fn().mockResolvedValue({ ...receipt, logs: [{ address: f.business.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "ChangeCancelled", args: { changeId: id } }), data: "0x" }] }) });
      expect(await recordQueuedChange(f.business.id, keccak256(stringToHex("cancel queue")))).toMatchObject({ ok: true, status: "cancelled" });
      const [row] = await db.select().from(queuedChanges).where(and(eq(queuedChanges.businessId, f.business.id), eq(queuedChanges.changeId, id)));
      expect(row!.status).toBe("cancelled");
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps a member when the required onchain role read fails", async () => {
    const f = await fixture();
    const [target] = await db.insert(users).values({ wallet: randomAddress() }).returning();
    await db.insert(members).values({ businessId: f.business.id, userId: target!.id, role: "approver" });
    chain.approverBudgetCount.mockRejectedValue(new Error("Role RPC unavailable"));
    await expect(removeMember(db, f.client, cfg.deployment, f.user, f.business.id, target!.id)).rejects.toMatchObject({ status: 502 });
    expect(await db.select().from(members).where(and(eq(members.businessId, f.business.id), eq(members.userId, target!.id)))).toHaveLength(1);
  });
  it("keeps an approver's app role unchanged when revocation cannot be checked", async () => {
    const f = await fixture();
    const [target] = await db.insert(users).values({ wallet: randomAddress() }).returning();
    await db.insert(members).values({ businessId: f.business.id, userId: target!.id, role: "approver" });
    chain.approverBudgetCount.mockRejectedValue(new Error("Role RPC unavailable"));
    await expect(setMemberRole(db, f.client, cfg.deployment, f.user, f.business.id, target!.id, "viewer")).rejects.toMatchObject({ status: 502 });
    const [member] = await db.select().from(members).where(and(eq(members.businessId, f.business.id), eq(members.userId, target!.id)));
    expect(member!.role).toBe("approver");
  });
  it("keeps a member whose only onchain approval grant is a custom budget", async () => {
    const f = await fixture();
    const [target] = await db.insert(users).values({ wallet: randomAddress() }).returning();
    const budget = keccak256(encodeFunctionData({ abi: symbolonVaultAbi, functionName: "setBudget", args: [ZERO32, 100n, 86400n] }));
    await db.insert(members).values({ businessId: f.business.id, userId: target!.id, role: "approver", budgets: [budget] });
    chain.approverBudgetCount.mockResolvedValue(1n);
    chain.isApprover.mockImplementation(async (args: readonly string[]) => args[2] === budget);
    await expect(removeMember(db, f.client, cfg.deployment, f.user, f.business.id, target!.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(members).where(and(eq(members.businessId, f.business.id), eq(members.userId, target!.id)))).toHaveLength(1);
  });
  it("preserves an approval-rejection hold when delivery is later confirmed", async () => {
    const f = await fixture();
    await rejectApproval(db, f.client, cfg, f.user, f.business.id, { fingerprint: f.fingerprint, reason: "Owner declined this payment independently of delivery." });
    await recordDeliveryOutcome(db, { businessId: f.business.id, fingerprint: f.fingerprint, action: "confirm", confirmedBy: f.user.id });
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.businessId, f.business.id), eq(invoices.fingerprint, f.fingerprint)));
    expect(invoice).toMatchObject({ status: "held", holdSource: "human" });
  });
  it("refuses pay-now for a Seal this business blocked", async () => {
    const f = await fixture("awaiting_approval", true);
    const prepared = await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.ok).toBe(false);
  });
  it("refuses pay-now until an owner releases the human hold", async () => {
    const f = await fixture("held");
    const prepared = await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.ok).toBe(false);
  });
  it("holds a duplicate candidate instead of preparing its payment", async () => {
    const f = await fixture();
    await db.insert(invoices).values({ ...f.row, fingerprint: `0x${"ac".repeat(32)}`, invoiceNumber: "AUDIT-2" });
    const prepared = await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.ok).toBe(false);
  });
  it("stores a valid signed first-payment approval using the signed amount", async () => {
    const f = await fixture();
    chain.remaining.mockResolvedValue(0n);
    chain.ledgerState.mockResolvedValue({ seen: false, cancelled: false });
    const deadline = f.facts.now + 86400n;
    const signature = await signSealMessage(f.userKey, typedData(sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger), "Approval", {
      vault: getAddress(f.business.vault!), fingerprint: f.fingerprint, credit: f.row.total, deadline,
    }));
    await submitApproval(db, f.client, cfg, f.user, f.business.id, { fingerprint: f.fingerprint, deadline: deadline.toString(), signature });
    const [saved] = await db.select().from(approvals).where(and(eq(approvals.businessId, f.business.id), eq(approvals.fingerprint, f.fingerprint)));
    expect(saved!.credit).toBe(f.row.total);
  });
  it("prepares and verifies a signature for only the remaining partial-payment credit", async () => {
    const f = await fixture();
    chain.remaining.mockResolvedValue(60_000_000n);
    const prepared = await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    expect(prepared.credit).toBe("60000000");
    const signature = await f.userKey.signTypedData(JSON.parse(prepared.typedDataJson));
    await submitApproval(db, f.client, cfg, f.user, f.business.id, { fingerprint: f.fingerprint, deadline: prepared.deadline, signature });
    const [saved] = await db.select().from(approvals).where(and(eq(approvals.businessId, f.business.id), eq(approvals.fingerprint, f.fingerprint)));
    expect(saved!.credit).toBe(60_000_000n);
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: true, summary: { credit: "60.000000", amount: "60.000000" } });
  });
  it("does not prepare a call or signature when the ledger status read fails", async () => {
    const f = await fixture();
    chain.ledgerState.mockRejectedValue(new Error("Ledger status unavailable"));
    await expect(prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).rejects.toMatchObject({ status: 502 });
    await expect(preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).rejects.toMatchObject({ status: 502 });
    expect(f.client.simulateContract).not.toHaveBeenCalled();
  });
  it("does not use invented cash when the live cash read fails", async () => {
    const f = await fixture();
    chain.cash.mockRejectedValue(new Error("Token balance unavailable"));
    await expect(preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).rejects.toMatchObject({ status: 502 });
    expect(f.client.simulateContract).not.toHaveBeenCalled();
  });
  it.each(["settled", "cancelled"] as const)("does not prepare a signature or wallet call for a %s fingerprint", async (state) => {
    const f = await fixture();
    chain.remaining.mockResolvedValue(0n);
    chain.ledgerState.mockResolvedValue({ seen: true, cancelled: state === "cancelled" });
    await expect(prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).rejects.toMatchObject({ status: 409 });
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: false });
    expect(f.client.simulateContract).not.toHaveBeenCalled();
  });
  it("ignores another business's same-vendor duplicate candidates", async () => {
    const f = await fixture();
    const [other] = await db.insert(businesses).values({ name: "Other payer", chainId: cfg.chainId, vault: randomAddress() }).returning();
    await db.insert(invoices).values({ ...f.row, businessId: other!.id, fingerprint: keccak256(stringToHex(crypto.randomUUID())) });
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: true });
  });
  it("refuses payment when the recorded screening was for a different payout address", async () => {
    const f = await fixture();
    chain.facts.mockResolvedValue({ ...f.facts, policy: { ...f.facts.policy, screeningMaxAge: 86400n } });
    const [screening] = await db.insert(screenings).values({ businessId: f.business.id, seal: f.row.seal, address: randomAddress(), risk: 0, result: "APPROVED", provider: "Circle", screenedAt: new Date() }).returning();
    const record = { version: 1 as const, kind: "screening_recorded", business: f.business.id, at: new Date().toISOString(), mode: "assist" as const, inputs: { screeningId: screening!.id }, options: [], rule: "screening recorded", outcome: "recorded" };
    await db.insert(decisions).values({ businessId: f.business.id, kind: record.kind, hash: hashRecord(record).hash, record });
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: false });
    expect(f.client.simulateContract).not.toHaveBeenCalled();
  });
  it("does not enable a missing Early Pay program or discount using too little real cash", async () => {
    const f = await fixture("awaiting_approval", false, true);
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: false });
    await db.update(businesses).set({ earlyPay: { enabled: true, minSpreadBps: 0, cashCapBps: 10000 } }).where(eq(businesses.id, f.business.id));
    chain.cash.mockResolvedValue(1n);
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: false });
    expect(f.client.simulateContract).not.toHaveBeenCalled();
    chain.cash.mockResolvedValue(250_000_000n);
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: true });
  });
  it("takes unseen credit from the signed document rather than a changed DB total", async () => {
    const f = await fixture();
    await db.update(invoices).set({ total: 999_000_000n }).where(eq(invoices.fingerprint, f.fingerprint));
    chain.remaining.mockResolvedValue(0n);
    chain.ledgerState.mockResolvedValue({ seen: false, cancelled: false });
    expect(await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ credit: "100000000" });
  });
  it("rejects a valid signer who signed a different approval credit", async () => {
    const f = await fixture();
    const prepared = await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint);
    const payload = JSON.parse(prepared.typedDataJson);
    payload.message.credit = "1";
    const signature = await f.userKey.signTypedData(payload);
    await expect(submitApproval(db, f.client, cfg, f.user, f.business.id, { fingerprint: f.fingerprint, deadline: prepared.deadline, signature })).rejects.toThrow(/signature rejected/);
    expect(await db.select().from(approvals).where(eq(approvals.businessId, f.business.id))).toHaveLength(0);
  });
  it("honors a custom-budget approver while refusing an owner-level payment", async () => {
    const f = await fixture();
    const budget = keccak256(stringToHex("Audit scoped budget"));
    await db.update(members).set({ role: "approver", budgets: [budget] }).where(eq(members.businessId, f.business.id));
    chain.state.mockResolvedValue({ owner: randomAddress(), paused: false });
    const facts = { ...f.facts, payee: { ...f.facts.payee!, terms: { ...f.facts.payee!.terms, budget } } };
    chain.facts.mockResolvedValue(facts);
    chain.isApprover.mockImplementation(async (args: readonly string[]) => args[2] === budget);
    expect(await prepareApproval(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: true });
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: true });
    chain.facts.mockResolvedValue({ ...facts, policy: { ...facts.policy, ownerThreshold: 1n } });
    const before = vi.mocked(f.client.simulateContract).mock.calls.length;
    expect(await preparePayNow(db, f.client, cfg, f.user, f.business.id, f.fingerprint)).toMatchObject({ ok: false });
    expect(f.client.simulateContract).toHaveBeenCalledTimes(before);
  });
  it("does not label a DB-only batch anchored without chain confirmation", async () => {
    const f = await fixture();
    const hash = hashRecord({ version: 1, kind: "audit", business: f.business.id, at: new Date().toISOString(), mode: "assist", inputs: {}, options: [], rule: "audit", outcome: "audit" }).hash;
    const { buildTree } = await import("@symbolon/steward");
    const tree = buildTree([hash]);
    await db.insert(decisionAnchors).values({ businessId: f.business.id, root: tree.root, count: 1, leaves: [hash] });
    const result = await anchorState(db, f.client, cfg, f.business.id, hash);
    expect(result.status).not.toBe("anchored");
  });
  it("does not link an unrelated business transaction to this decision", async () => {
    const f = await fixture();
    const record = { version: 1 as const, kind: "hold", business: f.business.id, at: new Date().toISOString(), mode: "assist" as const, inputs: {}, options: [], rule: "audit", outcome: "held" };
    const [decision] = await db.insert(decisions).values({ businessId: f.business.id, kind: "hold", hash: hashRecord(record).hash, record }).returning();
    const txHash = `0x${"cd".repeat(32)}`;
    const unrelated = { ...record, kind: "fund", inputs: { txHash }, outcome: "funded" };
    await db.insert(decisions).values({ businessId: f.business.id, kind: "fund", hash: hashRecord(unrelated).hash, record: unrelated });
    const result = await loadDecision(db, f.client, cfg, f.user, f.business.id, decision!.id);
    expect(result!.txHash).toBeNull();
  });
  it("does not report a partial settlement fully paid when the live ledger read fails", async () => {
    const f = await fixture();
    chain.scanLogs.mockResolvedValue({ logs: [{
      blockNumber: 1n, transactionHash: `0x${"ef".repeat(32)}`,
      args: { fingerprint: f.fingerprint, payer: f.business.vault, token: cfg.deployment.tokens.usdc,
        credit: 40_000_000n, paid: 40_000_000n, discountBps: 0 },
    }] });
    chain.invoiceStatus.mockRejectedValue(new Error("RPC unavailable"));
    const result = await loadReceipt(db, f.client, cfg, f.fingerprint);
    expect(result).toMatchObject({ state: "unconfirmed" });
  });
});
