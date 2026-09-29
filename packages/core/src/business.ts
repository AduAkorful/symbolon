import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";

import { factoryCall, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, members, seals, type Database } from "@symbolon/db";
import type { VaultPolicy } from "@symbolon/steward";

export type PolicyTemplate = "starter" | "standard" | "strict";

const HOUR = 3_600n;
const DAY = 24n * HOUR;

/**
 * Starting policies (spec §9); every rule stays editable. Amounts in raw units of the Vault's accounting decimals.
 * - starter: a solo founder paying a few vendors — fewer humans in the loop, still every onchain guard.
 * - standard: spec §9's examples (auto-pay 1,000 for vendors with 3+ paid invoices, owner over 10,000, screening
 *   within 30 days, 72h change cooldown).
 * - strict: lower limits, longer delays, every new vendor's first five invoices reviewed.
 */
export function policyTemplate(template: PolicyTemplate, decimals = 6): VaultPolicy {
  const unit = 10n ** BigInt(decimals);
  const common = { changeCooldown: 72n * HOUR, maxBridgeFee: 5n * unit };
  switch (template) {
    case "starter":
      return {
        ...common,
        perTxCap: 25_000n * unit,
        autoPayLimit: 1_000n * unit,
        ownerThreshold: 10_000n * unit,
        newVendorMinPaid: 1,
        screeningMaxAge: 0n,
        newPayeeDelay: 0n,
        looseningDelay: 12n * HOUR,
      };
    case "standard":
      return {
        ...common,
        perTxCap: 50_000n * unit,
        autoPayLimit: 1_000n * unit,
        ownerThreshold: 10_000n * unit,
        newVendorMinPaid: 3,
        screeningMaxAge: 30n * DAY,
        newPayeeDelay: DAY,
        looseningDelay: DAY,
      };
    case "strict":
      return {
        ...common,
        perTxCap: 10_000n * unit,
        autoPayLimit: 500n * unit,
        ownerThreshold: 5_000n * unit,
        newVendorMinPaid: 5,
        screeningMaxAge: 7n * DAY,
        newPayeeDelay: 2n * DAY,
        looseningDelay: 2n * DAY,
      };
  }
}

/** The owner's `createVault` call on the current release's factory. Auto-update stays off unless the owner opts in. */
export function createVaultCall(
  deployment: Deployment,
  a: { owner: Address; steward?: Address; policy: VaultPolicy; tokens?: Address[]; autoUpdate?: boolean },
) {
  return factoryCall(deployment.contracts.vaultFactory, "createVault", [
    a.owner,
    a.steward ?? "0x0000000000000000000000000000000000000000",
    a.policy,
    a.tokens ?? [deployment.tokens.usdc],
    6,
    a.autoUpdate ?? false,
  ]);
}

export async function registerBusiness(db: Database, a: { name: string; chainId: number; ownerUserId: string }): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [b] = await tx.insert(businesses).values({ name: a.name.trim(), chainId: a.chainId }).returning({ id: businesses.id });
    await tx.insert(members).values({ businessId: b!.id, userId: a.ownerUserId, role: "owner" });
    return { id: b!.id };
  });
}

/**
 * Links a business to its Vault only after checking onchain that one of Symbolon's factories made it and that it's
 * owned by the expected wallet (never trust an address the browser reports).
 */
export async function recordVault(
  db: Database,
  contracts: SymbolonContracts,
  a: { businessId: string; vault: Address; expectedOwner: Address; factories: SymbolonContracts["factory"][] },
): Promise<void> {
  const vault = getAddress(a.vault);
  const made = await Promise.all(a.factories.map((f) => f.read.isVault([vault])));
  if (!made.some(Boolean)) throw new Error(`${vault} wasn't created by a Symbolon factory`);
  const state = await contracts.lens.read.getVaultState([vault]);
  if (getAddress(state.owner) !== getAddress(a.expectedOwner)) throw new Error(`${vault} is owned by ${state.owner}, not ${a.expectedOwner}`);
  await db.update(businesses).set({ vault: vault.toLowerCase() }).where(eq(businesses.id, a.businessId));
}

const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(["admin", "api", "app", "help", "support", "symbolon", "verify", "www"]);

export async function registerSeal(
  db: Database,
  a: { userId: string; address: Address; handle: string; displayName: string; legalName?: string; website?: string },
): Promise<void> {
  const handle = a.handle.trim().toLowerCase();
  if (!HANDLE.test(handle) || RESERVED.has(handle)) throw new Error(`"${a.handle}" isn't an available handle`);
  await db.insert(seals).values({
    address: a.address.toLowerCase(),
    userId: a.userId,
    handle,
    displayName: a.displayName.trim(),
    ...(a.legalName ? { legalName: a.legalName.trim() } : {}),
    ...(a.website ? { website: a.website.trim() } : {}),
  });
}
