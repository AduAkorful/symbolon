import { toHex } from "viem";

/** The slice of an EIP-1193 provider that sign-in uses */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon: string;
  provider: Eip1193;
}

/**
 * Finds the wallets installed in this browser the standard way (EIP-6963: each announces itself), falling back to the
 * single injected `window.ethereum` for older ones. Resolves after a short wait, because wallets announce asynchronously.
 */
export function discoverWallets(waitMs = 300): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: Eip1193 }>).detail;
      found.set(info.uuid, { id: info.uuid, name: info.name, icon: info.icon, provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (found.size === 0 && legacy) found.set("injected", { id: "injected", name: "Browser wallet", icon: "", provider: legacy });
      resolve([...found.values()]);
    }, waitMs);
  });
}

/** The person closed the wallet's request (EIP-1193 code 4001), which is a choice, not an error */
export const isUserRejection = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === 4001;

/** Asks the wallet for an account, then for a signature over `message`. Nothing is sent onchain. */
export async function signWith(
  provider: Eip1193,
  fetchMessage: (address: string) => Promise<string>,
): Promise<{ address: string; message: string; signature: string }> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet didn't share an account.");
  const message = await fetchMessage(address);
  const signature = (await provider.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
  return { address, message, signature };
}
