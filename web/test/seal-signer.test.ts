import { afterEach, describe, expect, it, vi } from "vitest";
import { signInvoice } from "@/components/vendor/seal-signer";
import type { ChainParams } from "@/components/setup/owner-signer";
import type { Eip1193 } from "@/components/signin/wallet";

const chain: ChainParams = { chainIdHex: "0x4cef52", name: "Arc Testnet", currency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.example.test"], explorerUrl: "https://explorer.example.test" };
const ME = "0xAbCdEf0000000000000000000000000000000001";
const plan = { kind: "wallet", address: ME, chain } as const;
const prepared = { document: { seal: ME.toLowerCase() }, typedData: '{"primaryType":"Invoice","message":{"seal":"0xabc"}}' };
const SIG = `0x${"ab".repeat(65)}`;

function wallet(o: { accounts?: string[]; chainId?: string; result?: unknown; reject?: boolean } = {}) {
  const calls: { method: string; params?: unknown[] }[] = [];
  const p: Eip1193 = {
    async request(a) {
      calls.push(a);
      if (a.method === "eth_signTypedData_v4" && o.reject) throw Object.assign(new Error("rejected"), { code: 4001 });
      if (a.method === "eth_requestAccounts") return o.accounts ?? [ME];
      if (a.method === "eth_chainId") return o.chainId ?? chain.chainIdHex;
      if (a.method === "wallet_switchEthereumChain") return null;
      if (a.method === "eth_signTypedData_v4") return "result" in o ? o.result : SIG;
      throw new Error(`unexpected ${a.method}`);
    },
  };
  return { p, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("signing an invoice", () => {
  it("asks the wallet to sign the typed data exactly as the server prepared it, from the signed-in account, on Arc", async () => {
    const w = wallet({ chainId: "0x1" });
    expect(await signInvoice(plan, prepared, async () => [w.p])).toBe(SIG);
    const methods = w.calls.map((c) => c.method);
    expect(methods.indexOf("wallet_switchEthereumChain")).toBeLessThan(methods.indexOf("eth_signTypedData_v4"));
    expect(w.calls.at(-1)).toEqual({ method: "eth_signTypedData_v4", params: [ME, prepared.typedData] });
  });

  it("signs nothing when no wallet in the browser holds the account", async () => {
    const w = wallet({ accounts: ["0x0000000000000000000000000000000000000009"] });
    await expect(signInvoice(plan, prepared, async () => [w.p])).rejects.toThrow(/doesn't control the wallet on your Symbolon account/);
    expect(w.calls.some((c) => c.method === "eth_signTypedData_v4")).toBe(false);
  });

  it("passes on a rejection so the screen can say it was a choice", async () => {
    const w = wallet({ reject: true });
    await expect(signInvoice(plan, prepared, async () => [w.p])).rejects.toMatchObject({ code: 4001 });
  });

  it.each([undefined, "", "nope", 5, "0x", "0xzz"])("refuses a non-signature answer %j from the wallet", async (result) => {
    await expect(signInvoice(plan, prepared, async () => [wallet({ result }).p])).rejects.toThrow(/didn't return a signature/);
  });

  it("has no way to sign for an account that can't", async () => {
    await expect(signInvoice({ kind: "none", reason: "Sign in with a wallet." }, prepared, async () => [])).rejects.toThrow("Sign in with a wallet.");
  });
});
