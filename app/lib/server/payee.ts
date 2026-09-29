import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { verifySealedInvoice } from "@symbolon/seal";
import { symbolonContracts, symbolonVaultAbi, vaultCall, type Deployment } from "@symbolon/chain";
import { businesses, invoices, payees, seals, vendorInvitations, vendorVerifications, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const HASH = /^0x[0-9a-fA-F]{64}$/;

export async function payoutOptions(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, businessId: string, sealValue: string) {
  await requireMember(db, user.id, businessId, "owner");
  const seal = getAddress(sealValue);
  const [vendor] = await db.select().from(seals).where(eq(seals.address, seal.toLowerCase())).limit(1);
  if (!vendor) throw new AuthError(404, "That vendor Seal isn't registered.");
  const rows = await db.select({ envelope: invoices.envelope }).from(invoices).where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal.toLowerCase())));
  const options = new Map<string, { address: string; domain: number; source: string }>();
  for (const row of rows) {
    try {
      const checked = await verifySealedInvoice(row.envelope, { client, expected: { chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger } });
      if (checked.ok && checked.invoice) options.set(`${checked.invoice.payoutAddress.toLowerCase()}:${checked.invoice.payoutDomain}`, { address: checked.invoice.payoutAddress, domain: checked.invoice.payoutDomain, source: "signed invoice" });
    } catch { /* Invalid historical uploads are not trusted payout choices. */ }
  }
  if (vendor.payoutAddress) {
    // The Seal's configured payout is only an option on the ledger's local domain, as required by the first-contact flow.
    const c = symbolonContracts(client, deployment);
    const localDomain = await c.ledger.read.localDomain();
    options.set(`${vendor.payoutAddress}:${localDomain}`, { address: vendor.payoutAddress, domain: localDomain, source: "Seal payout setting · local domain" });
  }
  if (!options.size) throw new AuthError(409, "No payout address is available. The vendor must sign an invoice or set a payout in their Seal settings.");
  const [invitation] = await db.select({ terms: vendorInvitations.terms }).from(vendorInvitations).where(and(eq(vendorInvitations.businessId, businessId), eq(vendorInvitations.acceptedSeal, seal.toLowerCase()))).orderBy(desc(vendorInvitations.acceptedAt)).limit(1);
  const [verification] = await db.select({ cap: vendorVerifications.cap }).from(vendorVerifications).where(and(eq(vendorVerifications.businessId, businessId), eq(vendorVerifications.seal, seal.toLowerCase()), eq(vendorVerifications.status, "verified"))).orderBy(desc(vendorVerifications.updatedAt)).limit(1);
  return {
    options: [...options.values()],
    defaults: {
      monthlyCap: invitation?.terms?.monthlyCap ?? verification?.cap?.toString() ?? null,
      requirePo: invitation?.terms?.requirePo ?? false,
      requireDelivery: invitation?.terms?.requireDelivery ?? false,
    },
  };
}

export async function preparePayee(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, businessId: string, sealValue: unknown, choice: { payout: unknown; domain: unknown; requirePo: unknown; requireDelivery: unknown; monthlyCap?: unknown }) {
  await requireMember(db, user.id, businessId, "owner");
  let seal: Address;
  try { seal = getAddress(sealValue as string); } catch { throw new AuthError(400, "That Seal address is malformed."); }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");
  const [verification] = await db.select().from(payees).where(and(eq(payees.businessId, businessId), eq(payees.seal, seal.toLowerCase()), eq(payees.status, "verified"))).limit(1);
  if (!verification) throw new AuthError(409, "Verify this vendor before adding them as a payee.");
  const { options, defaults } = await payoutOptions(db, client, deployment, user, businessId, seal);
  if (typeof choice.payout !== "string" || !Number.isInteger(choice.domain)) throw new AuthError(400, "Choose one of the vendor's signed payout options.");
  const selected = options.find((o) => o.address.toLowerCase() === (choice.payout as string).toLowerCase() && o.domain === choice.domain);
  if (!selected) throw new AuthError(400, "That payout address isn't among the vendor's signed options.");
  const requirePo = choice.requirePo === undefined ? defaults.requirePo : choice.requirePo;
  const requireDelivery = choice.requireDelivery === undefined ? defaults.requireDelivery : choice.requireDelivery;
  if (typeof requirePo !== "boolean" || typeof requireDelivery !== "boolean") throw new AuthError(400, "Payee requirements are invalid.");
  const c = symbolonContracts(client, deployment);
  const vault = getAddress(business.vault);
  const [state, budget] = await Promise.all([
    c.lens.read.getVaultState([vault]),
    client.readContract({ address: vault, abi: symbolonVaultAbi, functionName: "OPERATING_BUDGET" }),
  ]);
  let monthlyCap = defaults.monthlyCap ? BigInt(defaults.monthlyCap) : state.policy.ownerThreshold;
  if (choice.monthlyCap === "") {
    monthlyCap = state.policy.ownerThreshold;
  } else if (choice.monthlyCap !== undefined && choice.monthlyCap !== null) {
    if (typeof choice.monthlyCap !== "string" || !/^\d{1,78}$/.test(choice.monthlyCap) || BigInt(choice.monthlyCap) <= 0n) throw new AuthError(400, "Enter a positive monthly cap in raw token units.");
    monthlyCap = BigInt(choice.monthlyCap);
  }
  const call = vaultCall(vault, "addPayee", [seal, getAddress(selected.address), selected.domain, { budget, requirePo, requireDelivery, monthlyCap }]);
  return { to: call.address, data: encodeFunctionData({ abi: symbolonVaultAbi, functionName: call.functionName, args: call.args }), chainId: deployment.chainId, summary: { seal, payout: selected, monthlyCap: monthlyCap.toString(), requirePo, requireDelivery } };
}

export async function recordPayee(db: Database, client: PublicClient, deployment: Deployment, user: Pick<SessionUser, "id">, businessId: string, txHash: unknown, expectedSealValue: unknown) {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof txHash !== "string" || !HASH.test(txHash)) throw new AuthError(400, "That isn't a transaction hash.");
  let expectedSeal: Address;
  try { expectedSeal = getAddress(expectedSealValue as string); } catch { throw new AuthError(400, "That expected Seal address is malformed."); }
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(business.vault);
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: txHash as Hex }); } catch { throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly."); }
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) throw new AuthError(409, "That successful transaction wasn't sent to this business's Vault.");
  const event = parseEventLogs({ abi: symbolonVaultAbi, eventName: "PayeeAdded", logs: receipt.logs }).filter((l) => getAddress(l.address) === vault);
  if (event.length !== 1) throw new AuthError(409, "That transaction didn't add exactly one payee to this Vault.");
  const args = event[0]!.args;
  if (getAddress(args.seal) !== expectedSeal) throw new AuthError(409, "That receipt added a different Seal than the selected vendor.");
  const { options } = await payoutOptions(db, client, deployment, user, businessId, expectedSeal);
  if (!options.some((option) => getAddress(option.address) === getAddress(args.payout) && option.domain === args.payoutDomain)) {
    throw new AuthError(409, "That receipt's payout isn't among the vendor's signed options.");
  }
  const c = symbolonContracts(client, deployment);
  const current = await c.lens.read.getPayee([vault, args.seal]);
  const termsAgree = current.terms.budget === args.terms.budget && current.terms.requirePo === args.terms.requirePo && current.terms.requireDelivery === args.terms.requireDelivery && current.terms.monthlyCap === args.terms.monthlyCap;
  if (!current.exists || getAddress(current.payout) !== getAddress(args.payout) || current.payoutDomain !== args.payoutDomain || current.activeAt !== args.activeAt || !termsAgree) throw new AuthError(409, "The Vault's current payee record doesn't match that receipt.");
  await appendAppDecision(db, businessId, { kind: "payee_added", subject: getAddress(args.seal).toLowerCase(), actor: user.id, inputs: { txHash, payout: args.payout, payoutDomain: args.payoutDomain, activeAt: args.activeAt.toString(), terms: { budget: args.terms.budget, requirePo: args.terms.requirePo, requireDelivery: args.terms.requireDelivery, monthlyCap: args.terms.monthlyCap.toString() } }, rule: "successful Vault receipt and live lens record agree", outcome: "payee_added" });
  return { seal: getAddress(args.seal).toLowerCase(), payout: getAddress(args.payout), activeAt: args.activeAt.toString(), txHash };
}
