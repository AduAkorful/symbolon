import { and, count, eq, isNull } from "drizzle-orm";
import { encodeFunctionData, erc20Abi, getAddress, parseAbiItem, parseEventLogs, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { createVaultCall, policyTemplate, recordVault, registerBusiness, type PolicyTemplate } from "@symbolon/core";
import { symbolonContracts, toTransaction, vaultCall, vaultFactoryAbi, type Deployment } from "@symbolon/chain";
import { businesses, members, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import { describePolicy, isTemplate, type PolicyText } from "./policy-text";
import type { SessionUser } from "./session";
import { pauseStateOf, readVaultState, stewardStanding } from "./vault-read";

// Plan 05h. The server decides what gets signed (H2) and confirms what was signed from the chain (H3).

export const MAX_BUSINESSES = 10;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export interface ChainSettings {
  chainId: number;
  deployment: Deployment;
}

export async function createBusiness(db: Database, user: Pick<SessionUser, "id">, name: string, chainId: number): Promise<{ id: string }> {
  const clean = name.normalize("NFC").trim();
  if (clean.length < 2 || clean.length > 80 || /\p{Cc}/u.test(clean)) throw new AuthError(400, "A business name is 2 to 80 characters, without control characters.");
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(and(eq(members.userId, user.id), eq(members.role, "owner"), eq(businesses.chainId, chainId)));
  if (n >= MAX_BUSINESSES) throw new AuthError(409, `You already own ${MAX_BUSINESSES} businesses. That's the limit.`);
  return registerBusiness(db, { name: clean, chainId, ownerUserId: user.id });
}

async function ownedBusiness(db: Database, cfg: ChainSettings, user: Pick<SessionUser, "id">, businessId: string) {
  if (!/^[0-9a-f-]{36}$/.test(businessId)) throw new AuthError(403, "You don't have access to do this for this business.");
  await requireMember(db, user.id, businessId, "owner");
  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b || b.chainId !== cfg.chainId) throw new AuthError(403, "You don't have access to do this for this business.");
  return b;
}

/** H1: the Vault's owner is the wallet the person proved at sign-in, never an address typed into a form */
function ownerWallet(user: Pick<SessionUser, "wallet">) {
  if (!user.wallet) throw new AuthError(409, "This account has no wallet to own a Vault. Sign in with a wallet, or with an email that has one.");
  return getAddress(user.wallet);
}

/** Makes (or finds) the business's Steward wallet and returns its address. Idempotent per business; null where none can be made. */
export type ProvisionSteward = (businessId: string) => Promise<string>;

/**
 * H10–H12. The Steward's wallet is provisioned first and saved on the business, then named as `steward` in `createVault`.
 * Called twice, it provisions once. If no wallet can be made, nothing is created (fails closed): no Vault without a Steward.
 */
async function stewardFor(db: Database, businessId: string, saved: string | null, provision: ProvisionSteward | null, owner: string): Promise<string> {
  let steward = saved;
  if (!steward) {
    if (!provision) throw new AuthError(503, "Steward wallets aren't available on this server yet, so a Vault can't be created. Nothing was created.");
    let made: string;
    try {
      made = getAddress(await provision(businessId));
    } catch (e) {
      // the message only: Circle's client errors carry no credentials, but nothing else about the request is worth logging either
      console.error("Steward wallet provisioning failed:", e instanceof Error ? e.message : "unknown error");
      throw new AuthError(502, "Couldn't create the Steward's wallet right now. Nothing was created. Try again in a moment.");
    }
    // first write wins; provisioning is idempotent per business, so a race saves the same address
    await db.update(businesses).set({ stewardWallet: made.toLowerCase() }).where(and(eq(businesses.id, businessId), isNull(businesses.stewardWallet)));
    const [row] = await db.select({ w: businesses.stewardWallet }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    steward = row?.w ?? null;
  }
  if (!steward) throw new AuthError(502, "The Steward's wallet couldn't be saved. Nothing was created.");
  // the Vault refuses a Steward that holds another role, so the owner's own wallet can't be it
  if (getAddress(steward) === owner) throw new AuthError(409, "The Steward's wallet can't be the same as the owner's wallet.");
  return getAddress(steward);
}

export async function prepareVault(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  template: unknown,
  provision: ProvisionSteward | null,
): Promise<{ to: string; data: Hex; chainId: number; summary: PolicyText; steward: string }> {
  if (!isTemplate(template)) throw new AuthError(400, "Choose Starter, Standard or Strict.");
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (b.vault) throw new AuthError(409, "This business already has a Vault.");
  const owner = ownerWallet(user);
  const steward = await stewardFor(db, b.id, b.stewardWallet, provision, owner);
  const call = createVaultCall(cfg.deployment, { owner, steward: steward as Address, policy: policyTemplate(template as PolicyTemplate) });
  return { ...toTransaction(call), chainId: cfg.chainId, summary: describePolicy(template), steward };
}

/**
 * H3. From a transaction hash, checks on the chain that this person's wallet created a Vault through Symbolon's current
 * factory, then saves it. The address comes from the log, never from the browser. Repeating the same hash is harmless.
 */
export async function confirmVault(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  txHash: unknown,
): Promise<{ vault: string; txHash: string }> {
  if (typeof txHash !== "string" || !HASH.test(txHash)) throw new AuthError(400, "That isn't a transaction hash.");
  const b = await ownedBusiness(db, cfg, user, businessId);
  const owner = ownerWallet(user);
  const factory = cfg.deployment.contracts.vaultFactory;

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet, or the chain can't be reached right now. Try again in a moment.");
  }
  if (receipt.status !== "success") throw new AuthError(409, "That transaction failed onchain, so no Vault was made.");
  if (!receipt.to || getAddress(receipt.to) !== getAddress(factory)) throw new AuthError(409, "That transaction wasn't sent to Symbolon's Vault factory.");
  const created = parseEventLogs({ abi: vaultFactoryAbi, eventName: "VaultCreated", logs: receipt.logs }).filter((l) => getAddress(l.address) === getAddress(factory));
  if (created.length !== 1) throw new AuthError(409, "That transaction didn't create exactly one Vault.");
  const { vault, owner: madeFor, steward: madeWith } = created[0]!.args;
  if (getAddress(madeFor) !== owner) throw new AuthError(403, "That Vault is owned by a different wallet than yours.");

  const blockNumber = receipt.blockNumber !== undefined ? BigInt(receipt.blockNumber) : null;
  if (b.vault) {
    if (getAddress(b.vault) === getAddress(vault)) {
      if ((b.vaultBlock === null || b.vaultBlock === undefined) && blockNumber !== null) {
        await db.update(businesses).set({ vaultBlock: blockNumber }).where(eq(businesses.id, businessId));
      }
      return { vault: b.vault, txHash };
    }
    throw new AuthError(409, "This business already has a different Vault.");
  }
  // H12: the chain must have got the Steward the server prepared for this business
  if (!b.stewardWallet || getAddress(madeWith) !== getAddress(b.stewardWallet)) throw new AuthError(409, "That Vault was made with a different Steward than this business's.");
  try {
    await recordVault(db, symbolonContracts(client, cfg.deployment), { businessId, vault, expectedOwner: owner, factories: [symbolonContracts(client, cfg.deployment).factory] });
    if (blockNumber !== null) {
      await db.update(businesses).set({ vaultBlock: blockNumber }).where(eq(businesses.id, businessId));
    }
  } catch (e) {
    // the unique (chain, vault) index: someone recorded this Vault first
    if (/unique|duplicate/i.test(String((e as { cause?: Error }).cause?.message ?? e))) throw new AuthError(409, "That Vault is already recorded for another business.");
    throw new AuthError(409, e instanceof Error ? e.message : "The Vault couldn't be confirmed onchain.");
  }
  return { vault: vault.toLowerCase(), txHash };
}

/** 6-decimal token amounts as the person types them: digits, an optional dot and up to 6 decimals, more than zero */
export function parseUsdcAmount(text: unknown): bigint {
  if (typeof text !== "string" || !/^\d{1,12}(\.\d{1,6})?$/.test(text.trim())) throw new AuthError(400, "Enter an amount like 250 or 250.50 (up to 6 decimals).");
  const v = parseUnits(text.trim(), 6);
  if (v <= 0n) throw new AuthError(400, "The amount has to be more than zero.");
  return v;
}

export async function prepareFund(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  amount: unknown,
): Promise<{ to: string; data: Hex; chainId: number }> {
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (!b.vault) throw new AuthError(409, "Create the Vault first.");
  const value = parseUsdcAmount(amount);
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(b.vault), value] });
  return { to: cfg.deployment.tokens.usdc, data, chainId: cfg.chainId };
}

/**
 * H13–H14. The owner's `pause()` or `unpause()`, sent to the business's recorded Vault (the row's, never the browser's).
 * Pausing is always available; resuming is the owner's deliberate act.
 */
export async function prepareVaultSwitch(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  action: "pause" | "resume",
): Promise<{ to: string; data: Hex; chainId: number }> {
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (!b.vault) throw new AuthError(409, "Create the Vault first.");
  const call = vaultCall(getAddress(b.vault), action === "pause" ? "pause" : "unpause", []);
  return { ...toTransaction(call), chainId: cfg.chainId };
}

/**
 * The Steward's standing on the chain, for the setup wizard (H13): recorded wallet vs what the Vault says, paused or not.
 * `ready` is true only when the chain shows this business's Steward set and the Vault paused.
 */
export async function vaultStanding(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<{ kind: string; steward: string | null; paused: boolean | null; ready: boolean; block: string | null; reason: string | null }> {
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (!b.vault) throw new AuthError(409, "Create the Vault first.");
  const state = await readVaultState(client, cfg.deployment, b.vault);
  const standing = stewardStanding(b.stewardWallet, state);
  const pause = pauseStateOf(state);
  return {
    kind: standing.kind,
    steward: b.stewardWallet ? getAddress(b.stewardWallet) : null,
    // paused is the Vault's own flag, so it is known even when the Steward doesn't match what we recorded
    paused: pause.known ? pause.paused : null,
    ready: standing.kind === "paused",
    block: pause.known ? pause.block.toString() : null,
    reason: standing.kind === "unknown" ? standing.reason : standing.kind === "mismatch" ? "The Vault's Steward isn't the wallet we set up for this business." : null,
  };
}

/** 18-decimal native fee amounts: digits, optional dot, up to 18 decimals */
export function parseNativeFeeAmount(text: unknown): bigint {
  if (typeof text !== "string" || !/^\d{1,12}(\.\d{1,18})?$/.test(text.trim())) {
    throw new AuthError(400, "Enter an amount like 0.1 or 1 (up to 18 decimals).");
  }
  const v = parseUnits(text.trim(), 18);
  if (v <= 0n) throw new AuthError(400, "The amount has to be more than zero.");
  return v;
}

export async function prepareFeeTransfer(
  db: Database,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  amount: unknown,
): Promise<{ to: string; data: Hex; value: string; chainId: number; amount: string }> {
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (!b.stewardWallet) throw new AuthError(409, "This business has no Steward wallet provisioned yet.");
  const value = parseNativeFeeAmount(amount);
  return {
    to: b.stewardWallet,
    data: "0x",
    value: `0x${value.toString(16)}`,
    chainId: cfg.chainId,
    amount: value.toString(),
  };
}

export async function recordFeeTransfer(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  businessId: string,
  txHash: unknown,
): Promise<{ ok: boolean; txHash: string; balance: string }> {
  if (typeof txHash !== "string" || !HASH.test(txHash)) throw new AuthError(400, "That isn't a transaction hash.");
  const b = await ownedBusiness(db, cfg, user, businessId);
  if (!b.stewardWallet) throw new AuthError(409, "This business has no Steward wallet provisioned yet.");
  const owner = ownerWallet(user);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet, or the chain can't be reached right now. Try again in a moment.");
  }
  if (receipt.status !== "success") throw new AuthError(409, "That transaction failed onchain.");
  if (!receipt.to || getAddress(receipt.to) !== getAddress(b.stewardWallet)) {
    throw new AuthError(409, "That transaction was not sent to this business's Steward wallet.");
  }
  if (getAddress(receipt.from) !== owner) {
    throw new AuthError(403, "That transaction was not sent from your wallet.");
  }

  const tx = await client.getTransaction({ hash: txHash as Hex });
  if (tx.value <= 0n) throw new AuthError(400, "That transaction did not transfer any native fee balance.");

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "steward_fees_funded",
      actor: user.id,
      inputs: {
        amount: tx.value.toString(),
        stewardWallet: b.stewardWallet,
        txHash: (txHash as string).toLowerCase(),
      },
      rule: "the owner funded the Steward wallet with network fees",
      outcome: "funded",
    },
  );

  const balance = await client.getBalance({ address: getAddress(b.stewardWallet) });
  return { ok: true, txHash: (txHash as string).toLowerCase(), balance: balance.toString() };
}

export async function ensureVaultBlock(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  businessId: string,
  vaultAddress: string,
): Promise<bigint> {
  const [b] = await db.select({ vaultBlock: businesses.vaultBlock }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (b?.vaultBlock !== null && b?.vaultBlock !== undefined) return b.vaultBlock;

  try {
    const factory = deployment.contracts.vaultFactory;
    const logs = await client.getLogs({
      address: factory,
      event: parseAbiItem("event VaultCreated(address indexed vault, address indexed owner, address indexed steward, uint8 release, address token, bool autoUpdate)"),
      args: { vault: getAddress(vaultAddress) },
      fromBlock: BigInt(deployment.startBlock),
      toBlock: "latest",
    });
    if (logs.length > 0 && logs[0]?.blockNumber) {
      const bn = BigInt(logs[0].blockNumber);
      await db.update(businesses).set({ vaultBlock: bn }).where(eq(businesses.id, businessId));
      return bn;
    }
  } catch (err) {
    console.error("ensureVaultBlock failed to backfill:", err);
  }
  return BigInt(deployment.startBlock);
}
