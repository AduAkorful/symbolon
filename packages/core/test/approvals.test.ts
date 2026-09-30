import { getAddress, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { approvals, businesses, createTestDb, decisions, users } from "@symbolon/db";
import { sealDomain, signSealMessage, typedData } from "@symbolon/seal";

import { anchorDecisions, recordApproval, registerBusiness } from "../src/index.js";

const CHAIN_ID = 5_042_002;
const LEDGER = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE" as const;
const VAULT = "0x5F5e2cd9F87A81724Cc48eC0C193630a60692984" as const;
const signerAccount = privateKeyToAccount(keccak256(stringToBytes("approver.signer")));
const d = { chainId: CHAIN_ID, ledger: LEDGER };
const FP = keccak256(stringToBytes("approval-fp")) as Hex;

async function signApproval(credit: bigint, deadline: bigint) {
  const msg = { vault: VAULT, fingerprint: FP, credit, deadline };
  const signature = await signSealMessage(signerAccount, typedData(sealDomain(CHAIN_ID, LEDGER), "Approval", msg));
  return { ...msg, signature, signer: signerAccount.address };
}

describe("approvals and anchoring", () => {
  it("records approval and updates it when a later deadline is submitted (A5)", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    const { id: businessId } = await registerBusiness(db, { name: "Acme", chainId: CHAIN_ID, ownerUserId: u!.id });

    const credit = 5_000_000_000n;
    const deadline1 = 1_790_000_000n;
    const app1 = await signApproval(credit, deadline1);

    await recordApproval(db, d, { businessId, ...app1 });

    const [row1] = await db.select().from(approvals);
    expect(row1).toBeDefined();
    expect(row1!.signature.toLowerCase()).toBe(app1.signature.toLowerCase());
    expect(Math.floor(row1!.deadline.getTime() / 1000)).toBe(Number(deadline1));

    // Submit refreshed approval with later deadline
    const deadline2 = 1_790_086_400n;
    const app2 = await signApproval(credit, deadline2);
    await recordApproval(db, d, { businessId, ...app2 });

    const rows = await db.select().from(approvals);
    expect(rows.length).toBe(1);
    expect(rows[0]!.signature.toLowerCase()).toBe(app2.signature.toLowerCase());
    expect(Math.floor(rows[0]!.deadline.getTime() / 1000)).toBe(Number(deadline2));
  });

  it("refuses to anchor without a wallet unless dryRun is set (A10)", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    const { id: businessId } = await registerBusiness(db, { name: "Acme", chainId: CHAIN_ID, ownerUserId: u!.id });
    await db.update(businesses).set({ vault: VAULT.toLowerCase() });

    await db.insert(decisions).values({
      businessId,
      kind: "pay",
      record: { test: true },
      hash: keccak256(stringToBytes("dec-1")),
    });

    // Without wallet and without dryRun: must throw
    await expect(anchorDecisions(db, businessId)).rejects.toThrow(/wallet required/);

    // With dryRun: succeeds
    const res = await anchorDecisions(db, businessId, undefined, { dryRun: true });
    expect(res).toBeDefined();
    expect(res?.count).toBe(1);
  });
});
