import { and, eq } from "drizzle-orm";
import { getAddress, type PublicClient } from "viem";

import { vaultLensAbi, type Deployment } from "@symbolon/chain";
import { businesses, invoices, payees, type Database } from "@symbolon/db";
import { verifySealedInvoice } from "@symbolon/seal";

export type InboxTrust = "verified" | "new_vendor" | "blocked" | "failed";

/**
 * Writes the inbox list's trust and currency flag onto the invoice rows. The list then reads Postgres. Opening one
 * invoice still verifies that envelope live. Re-run when a payee is verified or blocked, and from the indexer.
 */
export async function refreshInboxMirror(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  scope: { businessId: string; seal?: string },
): Promise<number> {
  const [biz] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, scope.businessId)).limit(1);
  const where = scope.seal
    ? and(eq(invoices.businessId, scope.businessId), eq(invoices.seal, scope.seal.toLowerCase()))
    : eq(invoices.businessId, scope.businessId);
  const rows = await db.select().from(invoices).where(where);
  if (rows.length === 0) return 0;

  const payeeRows = await db.select({ seal: payees.seal, status: payees.status }).from(payees).where(eq(payees.businessId, scope.businessId));
  const payeeBySeal = new Map(payeeRows.map((p) => [p.seal.toLowerCase(), p.status]));

  const supported = new Map<string, boolean | null>();
  const vault = biz?.vault ? getAddress(biz.vault) : null;
  if (vault) {
    const tokens = [...new Set(rows.map((r) => r.token.toLowerCase()))];
    await Promise.all(tokens.map(async (token) => {
      try {
        const ok = await client.readContract({
          address: deployment.contracts.vaultLens,
          abi: vaultLensAbi,
          functionName: "isSupportedToken",
          args: [vault, getAddress(token)],
        }) as boolean;
        supported.set(token, Boolean(ok));
      } catch {
        supported.set(token, null);
      }
    }));
  }

  let updated = 0;
  for (const row of rows) {
    let trust: InboxTrust = "failed";
    try {
      const v = await verifySealedInvoice(row.envelope, {
        client,
        expected: { chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger },
      });
      if (v.ok) {
        const status = payeeBySeal.get(row.seal.toLowerCase());
        trust = status === "blocked" ? "blocked" : status === "verified" ? "verified" : "new_vendor";
      }
    } catch {
      trust = "failed";
    }
    const flag = vault ? supported.get(row.token.toLowerCase()) : null;
    const currencyOff = flag === false ? true : flag === true ? false : null;
    if (row.inboxTrust === trust && row.currencyOff === currencyOff) continue;
    await db.update(invoices).set({ inboxTrust: trust, currencyOff }).where(eq(invoices.fingerprint, row.fingerprint));
    updated++;
  }
  return updated;
}
