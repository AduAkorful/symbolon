import type { Eip1193 } from "@/components/signin/wallet";
import { ensureChain, findWalletFor, type SignerPlan } from "@/components/setup/owner-signer";
import { postJson } from "@/lib/client/api";

// Plan 05i, V4. Signs the invoice the server prepared. The wallet is asked for the typed data exactly as the server built it; the
// dev signer sends only the document and the server rebuilds the typed data itself.

export async function signInvoice(plan: SignerPlan, prepared: { document: unknown; typedData: string }, discover: () => Promise<Eip1193[]>): Promise<string> {
  if (plan.kind === "none") throw new Error(plan.reason);
  if (plan.kind === "dev") return (await postJson<{ signature: string }>("/api/dev/sign", { document: prepared.document })).signature;
  const p = await findWalletFor(plan.address, await discover());
  if (!p) throw new Error("None of the wallets in this browser holds the account you signed in with. Open that wallet and try again.");
  await ensureChain(p, plan.chain);
  const signature = (await p.request({ method: "eth_signTypedData_v4", params: [plan.address, prepared.typedData] })) as string;
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) throw new Error("The wallet didn't return a signature.");
  return signature;
}
