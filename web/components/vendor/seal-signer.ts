import type { Eip1193 } from "@/components/signin/wallet";
import { ensureChain, findWalletFor, wrongWalletMessage, type SignerPlan } from "@/components/setup/owner-signer";

// Plan 05i, V4. Signs the invoice the server prepared. The wallet is asked for the typed data exactly as the server built it.

export async function signTypedData(plan: SignerPlan, typedDataJsonString: string, discover: () => Promise<Eip1193[]>): Promise<string> {
  if (plan.kind === "none") throw new Error(plan.reason);
  const p = await findWalletFor(plan.address, await discover());
  if (!p) throw new Error(wrongWalletMessage(plan.address));
  await ensureChain(p, plan.chain);
  const signature = (await p.request({ method: "eth_signTypedData_v4", params: [plan.address, typedDataJsonString] })) as string;
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) throw new Error("The wallet didn't return a signature.");
  return signature;
}

export async function signInvoice(plan: SignerPlan, prepared: { document: unknown; typedData: string }, discover: () => Promise<Eip1193[]>): Promise<string> {
  return signTypedData(plan, prepared.typedData, discover);
}

