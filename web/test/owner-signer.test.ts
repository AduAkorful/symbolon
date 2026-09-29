import { describe, expect, it } from "vitest";
import { NeedsFeesError, ensureChain, findWalletFor, sendCall, sendWithWallet, wasRejected, wrongWalletMessage, type ChainParams } from "@/components/setup/owner-signer";
import type { Eip1193 } from "@/components/signin/wallet";

const chain: ChainParams = { chainIdHex: "0x4cef52", name: "Arc Testnet", currency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.example.test"], explorerUrl: "https://explorer.example.test" };
const ME = "0xAbCdEf0000000000000000000000000000000001";
const plan = { kind: "wallet", address: ME, chain } as const;

function wallet(o: { accounts?: string[]; chainId?: string; knowsChain?: boolean; reject?: string; hash?: string; balance?: string }) {
  const calls: { method: string; params?: unknown[] }[] = [];
  let chainId = o.chainId ?? "0x1";
  const p: Eip1193 = {
    async request(a) {
      calls.push(a);
      if (a.method === o.reject) throw Object.assign(new Error("rejected"), { code: 4001 });
      switch (a.method) {
        case "eth_requestAccounts":
          return o.accounts ?? [ME];
        case "eth_chainId":
          return chainId;
        case "wallet_switchEthereumChain":
          if (o.knowsChain === false && chainId !== chain.chainIdHex && !calls.some((c) => c.method === "wallet_addEthereumChain")) throw Object.assign(new Error("unknown"), { code: 4902 });
          chainId = (a.params![0] as { chainId: string }).chainId;
          return null;
        case "wallet_addEthereumChain":
          return null;
        case "eth_getBalance":
          return o.balance ?? "0xde0b6b3a7640000";
        case "eth_sendTransaction":
          return o.hash ?? `0x${"ab".repeat(32)}`;
      }
      throw new Error(`unexpected ${a.method}`);
    },
  };
  return { p, calls };
}

describe("browser wallet signing", () => {
  it("finds the wallet that holds the signed-in account, in any letter case", async () => {
    const other = wallet({ accounts: ["0x0000000000000000000000000000000000000009"] });
    const mine = wallet({ accounts: [ME.toLowerCase()] });
    expect(await findWalletFor(ME, [other.p, mine.p])).toBe(mine.p);
    expect(await findWalletFor(ME, [other.p])).toBeNull();
  });

  it("switches to Arc before sending, and sends only from the signed-in account", async () => {
    const w = wallet({ chainId: "0x1" });
    const hash = await sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef" });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const methods = w.calls.map((c) => c.method);
    expect(methods.indexOf("wallet_switchEthereumChain")).toBeLessThan(methods.indexOf("eth_sendTransaction"));
    expect(w.calls.at(-1)!.params![0]).toEqual({ from: ME, to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef" });
  });

  it("doesn't switch when already on Arc", async () => {
    const w = wallet({ chainId: chain.chainIdHex });
    await ensureChain(w.p, chain);
    expect(w.calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });

  it("adds Arc from the registry's parameters when the wallet doesn't know it", async () => {
    const w = wallet({ chainId: "0x1", knowsChain: false });
    await ensureChain(w.p, chain);
    const add = w.calls.find((c) => c.method === "wallet_addEthereumChain")!;
    expect(add.params![0]).toMatchObject({ chainId: chain.chainIdHex, rpcUrls: chain.rpcUrls, blockExplorerUrls: [chain.explorerUrl] });
  });

  it("sends nothing if the person refuses the network switch, and says a refusal is a choice", async () => {
    const w = wallet({ chainId: "0x1", reject: "wallet_switchEthereumChain" });
    const e = await sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" }).catch((x: unknown) => x);
    expect(wasRejected(e)).toBe(true);
    expect(w.calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
  });

  it("refuses a wallet answer that isn't a transaction hash", async () => {
    const w = wallet({ chainId: chain.chainIdHex, hash: "0x12" });
    await expect(sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" })).rejects.toThrow(/transaction hash/);
  });

  it("explains when no wallet holds the account, and when this account can't send at all", async () => {
    const w = wallet({ accounts: ["0x0000000000000000000000000000000000000009"] });
    await expect(sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" })).rejects.toThrow(/doesn't control the wallet on your Symbolon account/);
    await expect(sendCall({ kind: "none", reason: "Not available." }, { to: "0x1", data: "0x" }, async () => [])).rejects.toThrow("Not available.");
  });

  it("sends nothing from a wallet with no USDC for fees, and says where to send some", async () => {
    const w = wallet({ chainId: chain.chainIdHex, balance: "0x0" });
    const e = await sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NeedsFeesError);
    expect((e as Error).message).toContain(ME);
    expect(w.calls.some((c) => c.method === "eth_sendTransaction")).toBe(false);
  });

  it("checks the balance after switching to Arc, of the signed-in account", async () => {
    const w = wallet({ chainId: "0x1" });
    await sendWithWallet([w.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" });
    const methods = w.calls.map((c) => c.method);
    expect(methods.indexOf("wallet_switchEthereumChain")).toBeLessThan(methods.indexOf("eth_getBalance"));
    expect(methods.indexOf("eth_getBalance")).toBeLessThan(methods.indexOf("eth_sendTransaction"));
    expect(w.calls.find((c) => c.method === "eth_getBalance")!.params![0]).toBe(ME);
  });

  it("names the account when this sign-in does not control it", async () => {
    const other = wallet({ accounts: ["0x0000000000000000000000000000000000000009"] });
    await expect(sendWithWallet([other.p], plan, { to: "0x1111111111111111111111111111111111111111", data: "0x" })).rejects.toThrow(wrongWalletMessage(ME));
  });
});
