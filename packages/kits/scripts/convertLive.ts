// Live Swap Kit check on Arc testnet (plan 14): quote, then convert 0.50 USDC → EURC from DEPLOYER_PK (never printed),
// confirming balances onchain rather than trusting the SDK's result.
import type { Hex } from "viem";

import { arcTestnet, createArcClient, getDeployment, symbolonContracts } from "@symbolon/chain";

import { conversionKitFromPrivateKey, convert, quoteConversion } from "../src/index.js";

const key = process.env.DEPLOYER_PK as Hex | undefined;
if (!key?.startsWith("0x")) throw new Error("DEPLOYER_PK must be set");
const kit = conversionKitFromPrivateKey(key, arcTestnet.id);
const d = getDeployment(arcTestnet.id);
const c = symbolonContracts(createArcClient(arcTestnet.id), d);
const { privateKeyToAccount } = await import("viem/accounts");
const me = privateKeyToAccount(key).address;
const req = { tokenIn: "USDC" as const, tokenOut: "EURC" as const, amountIn: 500_000n, slippageBps: 300 };

const q = await quoteConversion(kit, req);
console.log("quote:", JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 600));
if (process.argv.includes("--execute")) {
  const [usdc0, eurc0] = await Promise.all([c.token(d.tokens.usdc).read.balanceOf([me]), c.token(d.tokens.eurc).read.balanceOf([me])]);
  const r = await convert(kit, req);
  console.log("result:", JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 600));
  const [usdc1, eurc1] = await Promise.all([c.token(d.tokens.usdc).read.balanceOf([me]), c.token(d.tokens.eurc).read.balanceOf([me])]);
  console.log(`onchain: USDC ${usdc0} -> ${usdc1} (${usdc1 - usdc0}), EURC ${eurc0} -> ${eurc1} (+${eurc1 - eurc0})`);
}
