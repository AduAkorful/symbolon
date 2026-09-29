import { and, eq, gt } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";

import type { SignedApproval, SymbolonContracts } from "@symbolon/chain";
import { approvals, type Database } from "@symbolon/db";
import { digest, sealDomain, verifySealSignature, type SignatureClient } from "@symbolon/seal";
import { ApprovalLevel, type ApprovalLevelValue } from "@symbolon/steward";

/**
 * Stores an approver's or owner's EIP-712 `Approval` after checking the signature exactly as the Vault will (ECDSA
 * first, then ERC-1271). The Vault re-checks the signer's role and the deadline when the payment is made.
 */
export async function recordApproval(
  db: Database,
  deployment: { chainId: number; ledger: Address },
  a: { businessId: string; vault: Address; fingerprint: Hex; credit: bigint; deadline: bigint; signer: Address; signature: Hex },
  opts: { client?: SignatureClient } = {},
): Promise<void> {
  const d = digest(sealDomain(deployment.chainId, deployment.ledger), "Approval", {
    vault: a.vault,
    fingerprint: a.fingerprint,
    credit: a.credit,
    deadline: a.deadline,
  });
  const check = await verifySealSignature({ signer: a.signer, digest: d, signature: a.signature, client: opts.client });
  if (!check.valid) throw new Error(`approval signature rejected: ${check.reason}`);
  await db
    .insert(approvals)
    .values({
      businessId: a.businessId,
      fingerprint: a.fingerprint.toLowerCase(),
      credit: a.credit,
      signer: a.signer.toLowerCase(),
      deadline: new Date(Number(a.deadline) * 1000),
      signature: a.signature.toLowerCase(),
    })
    .onConflictDoNothing();
}

/**
 * Unexpired approvals for paying `credit` of an invoice, and the highest sign-off level they carry according to the
 * Vault's current roles (read through the lens).
 */
export async function collectApprovals(
  db: Database,
  contracts: SymbolonContracts,
  vault: Address,
  businessId: string,
  fingerprint: Hex,
  credit: bigint,
  budgetId: Hex,
  now: Date,
): Promise<{ approvals: SignedApproval[]; level: ApprovalLevelValue }> {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.businessId, businessId),
        eq(approvals.fingerprint, fingerprint.toLowerCase()),
        eq(approvals.credit, credit),
        gt(approvals.deadline, now),
      ),
    );
  if (rows.length === 0) return { approvals: [], level: ApprovalLevel.None };
  const owner = await contracts.lens.read.getVaultState([vault]).then((s) => s.owner);
  let level: ApprovalLevelValue = ApprovalLevel.None;
  const out: SignedApproval[] = [];
  for (const r of rows) {
    const signer = getAddress(r.signer);
    const isOwner = signer === owner;
    const isApprover =
      isOwner ||
      (await contracts.lens.read.isApprover([vault, signer, budgetId])) ||
      (await contracts.lens.read.isApprover([vault, signer, `0x${"00".repeat(32)}`]));
    if (!isApprover) continue;
    out.push({ signer, deadline: BigInt(Math.floor(r.deadline.getTime() / 1000)), signature: r.signature as Hex });
    const l = isOwner ? ApprovalLevel.Owner : ApprovalLevel.Approver;
    if (l > level) level = l;
  }
  return { approvals: out, level };
}
