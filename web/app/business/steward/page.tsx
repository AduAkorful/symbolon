import Link from "next/link";
import { getAddress } from "viem";
import { arcChain, symbolonContracts } from "@symbolon/chain";
import { humanResponseAgreement } from "@symbolon/core";
import { Shell } from "@/components/shell/Shell";
import { StewardClient, type DecisionView, type RunView } from "@/components/steward/StewardClient";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { summarizeDecision } from "@/lib/server/decision-text";
import { requirePageSession } from "@/lib/server/http";
import { describePolicyLines } from "@/lib/server/policy-text";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { feeBalance, formatFeeBalance, lastRun, listRunDecisions } from "@/lib/server/steward-runtime";
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";

export const dynamic = "force-dynamic";

export default async function BusinessStewardPage() {
  const session = await requirePageSession("/business/steward");
  const where = await loadSpaces(session);
  const business = where.business;

  if (!business) {
    return (
      <Shell where={where} current={{ kind: "business", id: "" }}>
        <div className="max-w-[760px]">
          <h1 className="font-display text-4xl">No business yet</h1>
          <p className="mt-2 text-graphite">
            You don’t belong to a business.{" "}
            <Link href="/setup" className="text-ink underline decoration-rule underline-offset-4">
              Set up a business
            </Link>
            .
          </p>
        </div>
      </Shell>
    );
  }

  if (!business.vault) {
    return (
      <Shell where={where} current={{ kind: "business", id: business.id }}>
        <div className="max-w-[760px]">
          <h1 className="font-display text-4xl">Vault not created yet</h1>
          <p className="mt-2 text-graphite">
            This business does not have an active Vault yet.{" "}
            {business.role === "owner" ? (
              <Link href={`/setup?business=${business.id}`} className="text-ink underline decoration-rule underline-offset-4">
                Finish setting up
              </Link>
            ) : (
              "Its owner hasn't finished setting up."
            )}
          </p>
        </div>
      </Shell>
    );
  }

  const db = await getDb();
  const client = getClient();
  const config = getConfig();
  const explorer = arcChain(config.chainId).blockExplorers?.default?.url ?? config.deployment.explorer;
  const signer = business.role === "owner" ? signerPlanFor(session, config) : null;

  let standing = { kind: "none", ready: false, block: null as string | null, reason: null as string | null };
  let policyLines: string[] = [];

  try {
    const vState = await readVaultState(client, config.deployment, business.vault);
    const s = stewardStanding(business.stewardWallet, vState);
    standing = {
      kind: s.kind,
      ready: s.kind === "paused" || s.kind === "active",
      block: "block" in s ? s.block.toString() : null,
      reason: s.kind === "unknown" ? s.reason : s.kind === "mismatch" ? "Vault steward does not match business record" : null,
    };
    if (vState.ok) {
      const contracts = symbolonContracts(client, config.deployment);
      const policy = await contracts.lens.read.getPolicy([getAddress(business.vault)]);
      policyLines = describePolicyLines(policy);
    }
  } catch (_err) {
    standing = { kind: "unknown", ready: false, block: null, reason: "Could not read Vault state from chain" };
  }

  const rawFee = business.stewardWallet ? await feeBalance(client, business.stewardWallet) : null;
  const fee = formatFeeBalance(rawFee);

  const run = await lastRun(db, business.id);
  const lastRunView: RunView | null = run
    ? {
        id: run.id,
        trigger: run.trigger,
        mode: run.mode,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        summary: run.summary as Record<string, unknown>,
        error: run.error,
      }
    : null;

  const rawDecisions = await listRunDecisions(db, business.id, 25);
  const recentDecisions: DecisionView[] = rawDecisions.map((d) => ({
    id: d.id,
    kind: d.kind,
    subject: d.subject,
    txHash: d.txHash,
    createdAt: d.createdAt.toISOString(),
    summary: summarizeDecision(d.record as Record<string, unknown>),
  }));

  const agreement = await humanResponseAgreement(db, business.id);
  const shadow = { agreed: agreement.agreed, compared: agreement.total, disagreements: [] };

  const pendingAnchorCount = await (async () => {
    const { decisionAnchors, decisions } = await import("@symbolon/db");
    const { eq } = await import("drizzle-orm");
    const anchoredBatches = await db
      .select({ leaves: decisionAnchors.leaves })
      .from(decisionAnchors)
      .where(eq(decisionAnchors.businessId, business.id));
    const anchored = new Set(anchoredBatches.flatMap((b) => b.leaves));
    const allBizDecs = await db
      .select({ hash: decisions.hash })
      .from(decisions)
      .where(eq(decisions.businessId, business.id));
    return allBizDecs.filter((d) => !anchored.has(d.hash)).length;
  })();

  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <StewardClient
        business={{
          id: business.id,
          name: business.name,
          vault: business.vault,
          stewardWallet: business.stewardWallet,
          mode: business.stewardMode,
          role: business.role,
        }}
        standing={standing}
        fee={fee}
        policyLines={policyLines}
        lastRun={lastRunView}
        recentDecisions={recentDecisions}
        shadow={shadow}
        pendingAnchorCount={pendingAnchorCount}
        signer={signer}
        explorer={explorer}
      />
    </Shell>
  );
}

