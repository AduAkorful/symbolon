// Live Gateway check (plan 14): deposit from the testnet deployer, then mint into the testnet Vault via a signed
// burn intent. Uses DEPLOYER_PK (never printed). Run: pnpm tsx scripts/gatewayFund.ts
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createWalletClient, fallback, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  arcTestnet,
  burnIntentTypedData,
  createArcClient,
  gatewayBalances,
  gatewayDepositCalls,
  gatewayDomain,
  gatewayInfo,
  gatewayMintCall,
  getDeployment,
  simulateCall,
  submitBurnIntents,
  symbolonContracts,
  type ContractCall,
} from "../src/index.js";

const DEPOSIT = 3_500_000n;
const VALUE = 1_000_000n;
const MAX_FEE = 2_010_000n; // Circle's quickstart value for a 1 USDC transfer

const key = process.env.DEPLOYER_PK as Hex | undefined;
if (!key?.startsWith("0x")) throw new Error("DEPLOYER_PK must be set");
const account = privateKeyToAccount(key);
const client = createArcClient(arcTestnet.id);
const wallet = createWalletClient({ account, chain: arcTestnet, transport: fallback(arcTestnet.rpcUrls.default.http.map((u) => http(u))) });
const d = getDeployment(arcTestnet.id);
const c = symbolonContracts(client, d);
const { vault } = JSON.parse(readFileSync(fileURLToPath(new URL("../../../contracts/deployments/smoke/5042002-vault.json", import.meta.url)), "utf8"));

async function send(call: ContractCall) {
  const { request } = await simulateCall(client, call, account);
  const hash = await wallet.writeContract(request as never);
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
}

const arc = gatewayDomain(await gatewayInfo("testnet"), d.cctpDomain);
console.log(`Gateway on Arc: wallet ${arc.walletContract.address}, minter ${arc.minterContract.address}`);
const before = (await gatewayBalances("testnet", account.address, [d.cctpDomain]))[0]!.balance;
if (before < VALUE + MAX_FEE) {
  for (const call of gatewayDepositCalls(arc.walletContract.address, d.tokens.usdc, DEPOSIT)) console.log(`sent ${await send(call)}`);
  for (let i = 0; i < 60; i++) {
    const b = (await gatewayBalances("testnet", account.address, [d.cctpDomain]))[0]!.balance;
    if (b >= VALUE + MAX_FEE) break;
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
console.log(`Gateway balance: ${(await gatewayBalances("testnet", account.address, [d.cctpDomain]))[0]!.balance}`);

const typed = burnIntentTypedData({
  source: { domain: d.cctpDomain, wallet: arc.walletContract.address, token: d.tokens.usdc },
  destination: { domain: d.cctpDomain, minter: arc.minterContract.address, token: d.tokens.usdc },
  depositor: account.address,
  recipient: getAddress(vault),
  value: VALUE,
  maxFee: MAX_FEE,
  salt: `0x${randomBytes(32).toString("hex")}`,
});
const signature = await account.signTypedData(typed as never);
const { attestation, signature: operator } = await submitBurnIntents("testnet", [{ burnIntent: typed.message, signature }]);
console.log(`attestation ${attestation.slice(0, 18)}…`);

const vaultBefore = await c.token(d.tokens.usdc).read.balanceOf([getAddress(vault)]);
const mintTx = await send(gatewayMintCall(arc.minterContract.address, attestation, operator));
const vaultAfter = await c.token(d.tokens.usdc).read.balanceOf([getAddress(vault)]);
console.log(`gatewayMint ${mintTx}: Vault ${vaultBefore} -> ${vaultAfter} (delta ${vaultAfter - vaultBefore})`);
if (vaultAfter - vaultBefore !== VALUE) throw new Error("Vault didn't receive exactly the value");
