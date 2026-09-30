import "server-only";

import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { eq } from "drizzle-orm";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { businesses, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import { requireMember } from "./access";
import { prepareChange, recordChange } from "./queued-change";
import { isLooseningTerms, type PayeeTermsShape } from "./loosening";

export async function preparePayeeTerms(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  params: {
    seal: string;
    terms: {
      budget: Hex;
      requirePo: boolean;
      requireDelivery: boolean;
      monthlyCap: bigint;
    };
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const [biz] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!biz?.vault) {
    throw new AuthError(400, "Business has no vault configured");
  }
  const vault = biz.vault as Address;

  let sealAddress: Address;
  try {
    sealAddress = getAddress(params.seal);
  } catch {
    throw new AuthError(400, "Invalid Seal address");
  }

  const contracts = symbolonContracts(client, deployment);
  const payee = await contracts.lens.read.getPayee([vault, sealAddress]);

  if (!payee.exists) {
    throw new AuthError(404, "Payee is not registered on this Vault");
  }

  const currentTerms: PayeeTermsShape = {
    budget: payee.terms.budget,
    requirePo: payee.terms.requirePo,
    requireDelivery: payee.terms.requireDelivery,
    monthlyCap: payee.terms.monthlyCap,
  };

  const nextTerms: PayeeTermsShape = {
    budget: params.terms.budget,
    requirePo: params.terms.requirePo,
    requireDelivery: params.terms.requireDelivery,
    monthlyCap: params.terms.monthlyCap,
  };

  const isLooser = isLooseningTerms(currentTerms, nextTerms);

  const prepared = await prepareChange(db, client, deployment, user, businessId, {
    kind: "update_payee_terms",
    args: [
      sealAddress,
      {
        budget: nextTerms.budget as Hex,
        requirePo: nextTerms.requirePo,
        requireDelivery: nextTerms.requireDelivery,
        monthlyCap: nextTerms.monthlyCap,
      },
    ],
  });

  return {
    ...prepared,
    isLooser,
  };
}

export async function recordPayeeTerms(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  txHash: Hex,
) {
  await requireMember(db, user.id, businessId, "owner");
  return recordChange(db, client, deployment, user, businessId, txHash);
}
