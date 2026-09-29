import { and, eq } from "drizzle-orm";
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAbiItem, getAddress, toFunctionSelector, type Hex } from "viem";
import { symbolonVaultAbi, vaultFactoryAbi, type Deployment } from "@symbolon/chain";
import { businesses, members, users, type Database } from "@symbolon/db";

// Plan 05h, H5 and H16: what the development test wallet may send. Kept apart from the key handling so it can be tested.

const PAUSE = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "pause" });
const UNPAUSE = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "unpause" });
const ADD_PAYEE = toFunctionSelector(getAbiItem({ abi: symbolonVaultAbi, name: "addPayee" }));
const CREATE_VAULT = toFunctionSelector(getAbiItem({ abi: vaultFactoryAbi, name: "createVault" }));
const TRANSFER = toFunctionSelector(getAbiItem({ abi: erc20Abi, name: "transfer" }));

/** Factory and USDC setup calls, plus tightly scoped owner calls on the signed-in user's own Vault. */
export async function devCallAllowed(db: Database, cfg: { chainId: number; deployment: Deployment }, userId: string, call: { to: string; data: Hex }): Promise<boolean> {
  const to = call.to.toLowerCase();
  const selector = call.data.slice(0, 10).toLowerCase();
  const mine = await db
    .select({ vault: businesses.vault })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(and(eq(members.userId, userId), eq(members.role, "owner"), eq(businesses.chainId, cfg.chainId)));
  const ownVault = (vault: string | null | undefined) => !!vault && vault.toLowerCase() === to;

  if (to === cfg.deployment.tokens.usdc.toLowerCase()) {
    if (selector !== TRANSFER.toLowerCase()) return false;
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
      return decoded.functionName === "transfer" && mine.some((b) => b.vault?.toLowerCase() === decoded.args[0].toLowerCase());
    } catch { return false; }
  }

  if (to === cfg.deployment.contracts.vaultFactory.toLowerCase()) {
    if (selector !== CREATE_VAULT.toLowerCase()) return false;
    try {
      const decoded = decodeFunctionData({ abi: vaultFactoryAbi, data: call.data });
      if (decoded.functionName !== "createVault") return false;
      const owner = getAddress(decoded.args[0]);
      const steward = getAddress(decoded.args[1]);
      const [account] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, userId)).limit(1);
      if (!account?.wallet || getAddress(account.wallet) !== owner) return false;
      const businessesForUser = await db.select({ vault: businesses.vault, stewardWallet: businesses.stewardWallet }).from(members).innerJoin(businesses, eq(businesses.id, members.businessId)).where(and(eq(members.userId, userId), eq(members.role, "owner"), eq(businesses.chainId, cfg.chainId)));
      return businessesForUser.some((b) => !b.vault && !!b.stewardWallet && getAddress(b.stewardWallet) === steward);
    } catch { return false; }
  }

  if (call.data !== PAUSE && call.data !== UNPAUSE && !(selector === ADD_PAYEE.toLowerCase() && call.data.length === 10 + 7 * 64)) return false;
  return mine.some((b) => ownVault(b.vault));
}
