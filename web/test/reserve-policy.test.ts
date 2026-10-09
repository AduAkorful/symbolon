import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, members, users } from "@symbolon/db";
import type { PublicClient } from "viem";
import { decodeFunctionData } from "viem";
import { symbolonVaultAbi } from "@symbolon/chain";

// Plan 05zb A2: the Treasury's "Change reserve policy" dialog prepares an owner-signed setReservePolicy call.

import { chainDouble, chainState } from "./setup-shared";

import { percentToBps, prepareReservePolicy } from "@/lib/server/reserve-policy";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(() => {
  chainDouble.enabled = true;
  chainState.getVaultState.mockReset();
  chainState.queuedChangeEta.mockReset();
  chainState.reserveStatus.mockReset();
});

const deployment = getDeployment(arcTestnet.id);
let n = 5000;
const address = () => "0x" + (n++).toString(16).padStart(40, "0");
const TELLER = "0x00000000000000000000000000000000000000aa";

async function fixture() {
  const ownerWallet = address();
  const vault = address();
  const [owner] = await db.insert(users).values({ email: `o-${crypto.randomUUID()}@example.test`, wallet: ownerWallet }).returning();
  const [approver] = await db.insert(users).values({ email: `a-${crypto.randomUUID()}@example.test`, wallet: address() }).returning();
  const [biz] = await db.insert(businesses).values({ name: "Acme", chainId: arcTestnet.id, vault }).returning();
  await db.insert(members).values([
    { businessId: biz!.id, userId: owner!.id, role: "owner" },
    { businessId: biz!.id, userId: approver!.id, role: "approver" },
  ]);
  chainState.getVaultState.mockResolvedValue({ owner: ownerWallet, policy: { looseningDelay: 86400n } });
  chainState.queuedChangeEta.mockResolvedValue(0n);
  return { owner: owner!, approver: approver!, biz: biz! };
}

const client = { getBlock: vi.fn().mockResolvedValue({ timestamp: 1_000_000n }) } as unknown as PublicClient;
const reserve = (policy: { enabled: boolean; maxReserveBps: number; minOperating: bigint }, entitled = true, teller = TELLER) => ({ usycTeller: teller, entitled, policy });

describe("percentToBps", () => {
  it("turns a percent with at most two decimals into basis points", () => {
    expect(percentToBps("30")).toBe(3000);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps(" 7 ")).toBe(700);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "-1", "100.01", "101", "1.234", "1e2", 30, null, undefined]) expect(() => percentToBps(bad)).toThrow(AuthError);
  });
});

describe("prepareReservePolicy", () => {
  it("encodes the owner's setReservePolicy call and says a looser change will queue", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: true, maxReserveBps: 2000, minOperating: 5_000_000_000n }));
    const res = await prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "30", minOperating: "1000.50" });
    expect(res.state).toBe("will-queue");
    expect(res.loosening).toBe(true); // a bigger share and a lower floor
    const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: res.data });
    expect(decoded.functionName).toBe("setReservePolicy");
    expect(decoded.args).toEqual([{ enabled: true, maxReserveBps: 3000, minOperating: 1_000_500_000n }]);
  });

  it("applies a tighter change at once", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: true, maxReserveBps: 3000, minOperating: 1_000_000_000n }));
    const res = await prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "10", minOperating: "5000" });
    expect(res.state).toBe("apply-now");
    expect(res.loosening).toBe(false);
  });

  it("refuses to switch the reserve on until Circle has allowlisted the Vault, but lets it be switched off", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: false, maxReserveBps: 0, minOperating: 0n }, false));
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "100" })).rejects.toThrow(/allowlisted/);
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: true, maxReserveBps: 2000, minOperating: 100_000_000n }, false));
    const off = await prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: false, maxReservePercent: "20", minOperating: "100" });
    expect(off.state).toBe("apply-now");
  });

  it("refuses a Vault release without the reserve, and a change that changes nothing", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: false, maxReserveBps: 0, minOperating: 0n }, true, "0x0000000000000000000000000000000000000000"));
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "100" })).rejects.toThrow(/doesn't support/);
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: true, maxReserveBps: 2000, minOperating: 100_000_000n }));
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "100" })).rejects.toThrow(/Nothing changed/);
  });

  it("says plainly when the reserve can't be read, and refuses amounts that aren't amounts", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockRejectedValue(new Error("rpc down"));
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "100" })).rejects.toMatchObject({ status: 502 });
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "1,000" })).rejects.toThrow(/operating floor/);
    await expect(prepareReservePolicy(db, client, deployment, f.owner, f.biz.id, { enabled: true, maxReservePercent: "20", minOperating: "1.0000001" })).rejects.toThrow(AuthError);
  });

  it("is for the owner only", async () => {
    const f = await fixture();
    chainState.reserveStatus.mockResolvedValue(reserve({ enabled: true, maxReserveBps: 2000, minOperating: 100_000_000n }));
    await expect(prepareReservePolicy(db, client, deployment, f.approver, f.biz.id, { enabled: true, maxReservePercent: "10", minOperating: "100" })).rejects.toThrow(AuthError);
  });
});
