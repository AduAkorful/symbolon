import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { describe, expect, it, vi } from "vitest";

import { circleBlockchain, provisionStewardWallet, STEWARD_WALLET_SET } from "../src/index.js";

// A stand-in for the Circle client: only the four calls the provisioner makes.
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";

function fakeCircle(over: { wallets?: unknown[]; failCreate?: boolean } = {}) {
  const wallets = [...(over.wallets ?? [])] as Array<{ id: string; address: string; blockchain: string; refId?: string; state: string }>;
  const sets: Array<{ id: string; name: string }> = [];
  const calls = { listWallets: vi.fn(), createWallets: vi.fn(), createWalletSet: vi.fn() };
  const circle = {
    listWallets: async (i: { refId?: string; blockchain?: string }) => {
      calls.listWallets(i);
      return { data: { wallets: wallets.filter((w) => (!i.refId || w.refId === i.refId) && (!i.blockchain || w.blockchain === i.blockchain)) } };
    },
    // Circle returns the original response for a repeated idempotency key
    createWalletSet: async (i: { name: string; idempotencyKey: string }) => {
      calls.createWalletSet(i);
      const s = sets[0] ?? { id: "set-new", name: i.name };
      if (!sets.length) sets.push(s);
      return { data: { walletSet: s } };
    },
    createWallets: async (i: { metadata: Array<{ refId: string }>; blockchains: string[] }) => {
      calls.createWallets(i);
      if (over.failCreate) throw new Error("circle is down");
      const w = { id: `w${wallets.length + 1}`, address: A2, blockchain: i.blockchains[0]!, refId: i.metadata[0]!.refId, state: "LIVE" };
      wallets.push(w);
      return { data: { wallets: [w] } };
    },
  };
  return { circle: circle as unknown as CircleDeveloperControlledWalletsClient, calls, wallets, sets };
}

describe("provisionStewardWallet", () => {
  it("names Circle's Arc chains from our chain ids, and nothing else", () => {
    expect(circleBlockchain(5042002)).toBe("ARC-TESTNET");
    expect(circleBlockchain(5042)).toBe("ARC");
    expect(() => circleBlockchain(1)).toThrow();
  });

  it("creates an EOA on the chain with the business id as refId, making the wallet set on first use", async () => {
    const { circle, calls, sets } = fakeCircle();
    const w = await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    expect(w).toEqual({ walletId: "w1", address: A2 });
    expect(sets).toEqual([{ id: "set-new", name: STEWARD_WALLET_SET }]);
    const input = calls.createWallets.mock.calls[0]![0];
    expect(input).toMatchObject({ blockchains: ["ARC-TESTNET"], count: 1, accountType: "EOA", walletSetId: "set-new", metadata: [{ refId: "biz-1" }] });
    expect(input.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("returns the wallet that already exists for the business instead of making a second one", async () => {
    const { circle, calls } = fakeCircle({ wallets: [{ id: "old", address: A1.toLowerCase(), blockchain: "ARC-TESTNET", refId: "biz-1", state: "LIVE" }] });
    const w = await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    expect(w).toEqual({ walletId: "old", address: A1 });
    expect(calls.createWallets).not.toHaveBeenCalled();
  });

  it("calling it twice provisions once", async () => {
    const { circle, calls } = fakeCircle();
    const a = await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    const b = await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    expect(b).toEqual(a);
    expect(calls.createWallets).toHaveBeenCalledTimes(1);
  });

  it("does not reuse another business's wallet or another chain's", async () => {
    const { circle, calls } = fakeCircle({ wallets: [
      { id: "other", address: A1, blockchain: "ARC-TESTNET", refId: "biz-2", state: "LIVE" },
      { id: "main", address: A1, blockchain: "ARC", refId: "biz-1", state: "LIVE" },
    ] });
    const w = await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    expect(w.walletId).not.toBe("other");
    expect(w.walletId).not.toBe("main");
    expect(calls.createWallets).toHaveBeenCalledTimes(1);
  });

  it("refuses to pick when Circle holds several wallets for one business", async () => {
    const two = [
      { id: "a", address: A1, blockchain: "ARC-TESTNET", refId: "biz-1", state: "LIVE" },
      { id: "b", address: A2, blockchain: "ARC-TESTNET", refId: "biz-1", state: "LIVE" },
    ];
    await expect(provisionStewardWallet(fakeCircle({ wallets: two }).circle, { chainId: 5042002, refId: "biz-1" })).rejects.toThrow(/2 wallets/);
  });

  it("uses the configured wallet set and doesn't touch wallet sets", async () => {
    const { circle, calls } = fakeCircle();
    await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1", walletSetId: "set-ops" });
    expect(calls.createWallets.mock.calls[0]![0].walletSetId).toBe("set-ops");
    expect(calls.createWalletSet).not.toHaveBeenCalled();
  });

  it("asks for the wallet set under one fixed key, so every business ends up in the same set", async () => {
    const { circle, calls } = fakeCircle();
    await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-1" });
    await provisionStewardWallet(circle, { chainId: 5042002, refId: "biz-2" });
    const keys = calls.createWalletSet.mock.calls.map((c) => c[0].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(calls.createWallets.mock.calls.map((c) => c[0].walletSetId)).toEqual(["set-new", "set-new"]);
  });

  it("lets a Circle failure through, so nothing is stored by the caller", async () => {
    await expect(provisionStewardWallet(fakeCircle({ failCreate: true }).circle, { chainId: 5042002, refId: "biz-1" })).rejects.toThrow("circle is down");
  });

  it("uses the same idempotency key for the same business every time, and a different one for another", async () => {
    const a = fakeCircle(), b = fakeCircle(), c = fakeCircle();
    await provisionStewardWallet(a.circle, { chainId: 5042002, refId: "biz-1" });
    await provisionStewardWallet(b.circle, { chainId: 5042002, refId: "biz-1" });
    await provisionStewardWallet(c.circle, { chainId: 5042002, refId: "biz-2" });
    const key = (x: ReturnType<typeof fakeCircle>) => x.calls.createWallets.mock.calls[0]![0].idempotencyKey;
    expect(key(a)).toBe(key(b));
    expect(key(a)).not.toBe(key(c));
  });
});
