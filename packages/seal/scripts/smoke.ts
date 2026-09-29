// Seals the live smoke-test invoice for a deployment (contracts/script/Smoke.s.sol, step 2).
// Reads the deployment registry and the smoke Vault; signs with DEPLOYER_PK (never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { completeTotals, sealInvoice, verifySealedInvoice, encodeSealedInvoice } from "../src/index.js";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? "5042002");
const WEEK = 7 * 86_400;
const deployments = fileURLToPath(new URL("../../../contracts/deployments/", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(`${deployments}${path}`, "utf8"));

const key = process.env.DEPLOYER_PK;
if (!key?.startsWith("0x")) throw new Error("DEPLOYER_PK must be set (0x-prefixed)");
const seal = privateKeyToAccount(key as `0x${string}`);

const registry = read(`${CHAIN_ID}.json`);
const smoke = read(`smoke/${CHAIN_ID}-vault.json`);
const ledger = getAddress(registry.contracts.InvoiceLedger) as Address;
const now = Math.floor(Date.now() / 1000);

const document = completeTotals({
  schema: "symbolon.invoice.v1",
  seal: seal.address.toLowerCase(),
  vendor: { name: "Symbolon smoke test (demo vendor)" },
  payer: { name: "Symbolon smoke test (demo payer)", vault: String(smoke.vault).toLowerCase() },
  invoiceNumber: `SMOKE-${now}`,
  issuedAt: now,
  dueDate: now + WEEK,
  currency: { chainId: CHAIN_ID, token: String(registry.external.usdc).toLowerCase(), symbol: "USDC", decimals: 6 },
  lineItems: [{ description: "Deployment smoke test", quantity: "1", unitPrice: "1" }],
  taxes: [],
  discounts: [],
  payout: { address: String(smoke.payout).toLowerCase(), domain: registry.cctpDomain },
  earlyPay: [],
  attachments: [],
  notes: "Demo data: a live test of the deployment, not a real invoice.",
});

const { sealed, invoice, fingerprint } = await sealInvoice({ signer: seal, chainId: CHAIN_ID, ledger, document });
const check = await verifySealedInvoice(sealed, { expected: { chainId: CHAIN_ID, ledger } });
if (!check.ok) throw new Error(`sealed invoice failed verification: ${JSON.stringify(check.issues)}`);

const out = `${deployments}smoke/${CHAIN_ID}-invoice.json`;
const invoiceJson = JSON.parse(JSON.stringify({ ...invoice, earlyPayCount: invoice.earlyPay.length }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
writeFileSync(out, `${JSON.stringify({ fingerprint, envelope: encodeSealedInvoice(sealed), invoice: invoiceJson, signature: sealed.signature }, null, 2)}\n`);
console.log(`sealed ${document.invoiceNumber}: fingerprint ${fingerprint} -> ${out}`);
