import { describe, expect, it, vi } from "vitest";
import { ensureWallets } from "@/components/wallet/connect-flow";
import { wasRejected } from "@/components/setup/owner-signer";

const noWait = async () => {};

describe("asking for a wallet when a signing action has none (plan 05zi)", () => {
  it("does not prompt when a wallet is already connected", async () => {
    const prompt = vi.fn(async () => "connected" as const);
    await ensureWallets({ count: () => 1, prompt, sleep: noWait });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts once when there is none, and carries on once the wallet shows up in the list", async () => {
    let wallets = 0;
    const prompt = vi.fn(async () => "connected" as const);
    let sleeps = 0;
    await ensureWallets({ count: () => wallets, prompt, sleep: async () => { if (++sleeps === 3) wallets = 1; } });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(wallets).toBe(1);
    expect(sleeps).toBe(3);
  });

  it("treats a closed window as the person's choice, which the signers report as 'nothing was sent'", async () => {
    const e = await ensureWallets({ count: () => 0, prompt: async () => "closed", sleep: noWait }).catch((x: unknown) => x);
    expect(wasRejected(e)).toBe(true);
    expect((e as Error).message).toMatch(/closed the wallet's request/);
  });

  it("goes on without a wallet when the window fails or never connects, leaving the signer to explain", async () => {
    await expect(ensureWallets({ count: () => 0, prompt: async () => "error", sleep: noWait })).resolves.toBeUndefined();
    let sleeps = 0;
    await expect(ensureWallets({ count: () => 0, prompt: async () => "connected", sleep: async () => { sleeps++; }, settleMs: 500 })).resolves.toBeUndefined();
    expect(sleeps).toBe(5); // gave up waiting for the list, did not hang
  });
});
