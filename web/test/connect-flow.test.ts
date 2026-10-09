import { describe, expect, it, vi } from "vitest";
import { ensureSignerSession, ensureWallets, WALLET_NOT_READY } from "@/components/wallet/connect-flow";
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

describe("restoring Privy's session before a signing action (our cookie can outlive it)", () => {
  function session(partial: Partial<Parameters<typeof ensureSignerSession>[0]> & { privy?: boolean; auth?: boolean; wallets?: boolean; count?: number }) {
    let privy = partial.privy ?? true;
    let auth = partial.auth ?? true;
    let wallets = partial.wallets ?? true;
    let count = partial.count ?? 1;
    const login = partial.login ?? vi.fn(async () => "connected" as const);
    const connect = partial.connect ?? vi.fn(async () => "connected" as const);
    const refresh = partial.refresh ?? vi.fn(async () => null);
    return {
      state: { get privy() { return privy; }, set privy(v: boolean) { privy = v; }, get auth() { return auth; }, set auth(v: boolean) { auth = v; }, get wallets() { return wallets; }, set wallets(v: boolean) { wallets = v; }, get count() { return count; }, set count(v: number) { count = v; } },
      login,
      connect,
      refresh,
      run: (over: Partial<Parameters<typeof ensureSignerSession>[0]> = {}) =>
        ensureSignerSession({
          privyReady: () => privy,
          authenticated: () => auth,
          walletsReady: () => wallets,
          walletCount: () => count,
          refresh,
          login,
          connect,
          sleep: noWait,
          initMs: 500,
          settleMs: 500,
          ...partial,
          ...over,
        }),
    };
  }

  it("does not open login or connect when Privy is already authenticated and a wallet is listed", async () => {
    const s = session({});
    await s.run();
    expect(s.login).not.toHaveBeenCalled();
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("waits for the SDK to initialise, then continues", async () => {
    const s = session({ privy: false, sleep: undefined });
    let sleeps = 0;
    await s.run({
      sleep: async () => {
        sleeps++;
        if (sleeps === 2) s.state.privy = true;
      },
    });
    expect(sleeps).toBe(2);
    expect(s.login).not.toHaveBeenCalled();
  });

  it("says the wallet is not ready when the SDK never initialises", async () => {
    const s = session({ privy: false });
    await expect(s.run({ sleep: noWait, initMs: 500 })).rejects.toThrow(WALLET_NOT_READY);
    expect(s.login).not.toHaveBeenCalled();
  });

  it("refreshes an expired Privy token instead of asking the person to sign in again", async () => {
    const s = session({ auth: false, refresh: vi.fn(async () => "token") });
    let sleeps = 0;
    await s.run({
      sleep: async () => {
        sleeps++;
        s.state.auth = true;
      },
    });
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.login).not.toHaveBeenCalled();
    expect(sleeps).toBe(1);
  });

  it("opens Privy's login when there is no Privy session to refresh, so an email/embedded wallet can come back", async () => {
    const s = session({ auth: false, refresh: vi.fn(async () => null), count: 0, wallets: false });
    let sleeps = 0;
    s.login = vi.fn(async () => {
      s.state.auth = true;
      return "connected" as const;
    });
    await s.run({
      login: s.login,
      sleep: async () => {
        sleeps++;
        s.state.wallets = true;
        s.state.count = 1;
      },
    });
    expect(s.login).toHaveBeenCalledTimes(1);
    expect(s.connect).not.toHaveBeenCalled();
  });

  it("treats a closed login window as the person's choice", async () => {
    const s = session({ auth: false, refresh: vi.fn(async () => null), login: vi.fn(async () => "closed" as const) });
    const e = await s.run().catch((x: unknown) => x);
    expect(wasRejected(e)).toBe(true);
    expect((e as Error).message).toMatch(/closed the wallet's request/);
    expect(s.connect).not.toHaveBeenCalled();
  });

  it("says the wallet is not ready when Privy is signed in but the wallet list never settles", async () => {
    const s = session({ wallets: false });
    await expect(s.run({ sleep: noWait, initMs: 500 })).rejects.toThrow(WALLET_NOT_READY);
    expect(s.connect).not.toHaveBeenCalled();
  });

  it("opens the connect window only after Privy is authenticated, when the list is still empty", async () => {
    const s = session({ count: 0 });
    s.connect = vi.fn(async () => {
      s.state.count = 1;
      return "connected" as const;
    });
    await s.run({ connect: s.connect });
    expect(s.login).not.toHaveBeenCalled();
    expect(s.connect).toHaveBeenCalledTimes(1);
  });
});
