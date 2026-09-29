import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createWalletClient, fallback, getAddress, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcChain } from "@symbolon/chain";
import { users, type Database } from "@symbolon/db";
import { parseDocument, sealDomain, signSealMessage, toInvoice, typedData } from "@symbolon/seal";
import { getClient } from "./chain";
import { getConfig } from "./config";
import { devSignInAllowed } from "./dev-signin";
import { devCallAllowed } from "./dev-wallet-policy";
import { AuthError } from "./errors";

// Plan 05h, H5. A local test key per dev test user so the setup flow can run against Arc testnet without a browser wallet.
// Development builds on a testnet only: every function starts with the same gate as the dev sign-in.

const FILE = () => resolve(process.cwd(), ".data/dev-wallets.json");

function gate() {
  if (!devSignInAllowed(getConfig())) throw new AuthError(404, "Not found.");
}

function keys(): Record<string, Hex> {
  try {
    return JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, Hex>;
  } catch {
    return {};
  }
}

function keyFor(userId: string): Hex {
  gate();
  const all = keys();
  if (all[userId]) return all[userId]!;
  const key = generatePrivateKey();
  mkdirSync(dirname(FILE()), { recursive: true });
  writeFileSync(FILE(), JSON.stringify({ ...all, [userId]: key }, null, 2), { mode: 0o600 });
  return key;
}

/** Gives a dev test user its local wallet, as the address on their account, so they can own a Vault */
export async function ensureDevWallet(db: Database, userId: string): Promise<string> {
  const address = privateKeyToAccount(keyFor(userId)).address.toLowerCase();
  await db.update(users).set({ wallet: address }).where(eq(users.id, userId));
  return address;
}

/** Signs and sends one call as the dev user's wallet, to Symbolon's own contracts only, and waits for the receipt */
export async function sendAsDevWallet(db: Database, userId: string, call: { to: string; data: Hex }): Promise<Hex> {
  gate();
  const { chainId, deployment } = getConfig();
  if (!(await devCallAllowed(db, { chainId, deployment }, userId, call))) throw new AuthError(403, "The test wallet only sends to Symbolon's factory, the USDC token, and pause or resume on your own Vault.");
  const account = privateKeyToAccount(keyFor(userId));
  const chain = arcChain(chainId);
  const client = getClient();
  const to = getAddress(call.to);
  // Simulate on the node first: Arc's USDC can't be simulated by a local EVM
  try {
    await client.call({ account, to, data: call.data });
  } catch (e) {
    throw new AuthError(409, `The transaction would fail: ${(e as { shortMessage?: string }).shortMessage ?? "the node rejected it"}.`);
  }
  const wallet = createWalletClient({ account, chain, transport: fallback(chain.rpcUrls.default.http.map((u) => http(u))) });
  let hash: Hex;
  try {
    hash = await wallet.sendTransaction({ to, data: call.data });
  } catch (e) {
    // Arc charges fees in USDC, so a fresh test wallet has to be funded first (testnet faucet or another wallet)
    if (/insufficient funds|exceeds the balance/i.test(String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message))) {
      throw new AuthError(409, `The test wallet ${account.address} has no USDC for network fees. Send it some testnet USDC and try again.`);
    }
    throw new AuthError(409, `The node rejected the transaction: ${(e as { shortMessage?: string }).shortMessage ?? "unknown reason"}.`);
  }
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new AuthError(409, `The transaction ${hash} failed onchain.`);
  return hash;
}

/**
 * Plan 05i, V4. Signs an invoice as the dev user's Seal. The typed data is rebuilt here from the document (never taken from the
 * browser), for the registry's chain and ledger, and only when the document is for this wallet's own Seal.
 */
export async function signInvoiceAsDevSeal(userId: string, document: unknown): Promise<Hex> {
  gate();
  const { chainId, deployment } = getConfig();
  const account = privateKeyToAccount(keyFor(userId));
  let invoice;
  try {
    invoice = toInvoice(parseDocument(document));
  } catch {
    throw new AuthError(400, "That isn't a valid invoice.");
  }
  if (getAddress(invoice.seal) !== account.address) throw new AuthError(403, "That invoice is for a different Seal than the test wallet's.");
  return signSealMessage(account, typedData(sealDomain(chainId, deployment.contracts.invoiceLedger), "Invoice", invoice));
}
