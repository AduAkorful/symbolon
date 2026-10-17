import Link from "next/link";
import { getAddress } from "viem";
import { arcChain, symbolonContracts } from "@symbolon/chain";
import { humanResponseAgreement } from "@symbolon/core";
import { Shell } from "@/components/shell/Shell";
import { StewardClient, type DecisionView, type RunView } from "@/components/steward/StewardClient";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { describePolicyLines } from "@/lib/server/policy-text";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { subjectRefs } from "@/lib/server/subject-label";
import { decisionNow, foldRecentDecisions, loadLendingEvents } from "@/lib/server/steward-decisions";
import { feeBalance, formatFeeBalance, lastRun, lastScheduledRun, listRunDecisions, listRuns, STEWARD_RUN_LEASE_MS } from "@/lib/server/steward-runtime";
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";
import { PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function BusinessStewardPage() {
  const session = await requirePageSession("/business/steward");
  const where = await loadSpaces(session);
  const business = where.business;

  if (!business) {
    return (
      <Shell where={where} current={{ kind: "business", id: "" }}>
        <div>
          <PageTitle>No business yet</PageTitle>
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
        <div>
          <PageTitle>Vault not created yet</PageTitle>
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

  const latest = await lastRun(db, business.id);
  const scheduled = await lastScheduledRun(db, business.id);
  // Runs come every minute or so, so the newest one is usually in progress. The card shows the last one that finished, and a line
  // says a run is going on now (QA retest 6, R5-11); a run past its lease is shown as stalled as before.
  const inProgress = latest && latest.status === "running" && Date.now() - latest.startedAt.getTime() <= STEWARD_RUN_LEASE_MS ? latest : null;
  const run = inProgress ? (await listRuns(db, business.id, 5)).find((r) => r.status !== "running") ?? latest : latest;
  const lastRunView: RunView | null = run
    ? {
        id: run.id,
        trigger: run.trigger,
        mode: run.mode,
        // a run still "running" after its lease has run out never finished; say so rather than show work in progress
        status: run.status === "running" && Date.now() - run.startedAt.getTime() > STEWARD_RUN_LEASE_MS ? "stalled" : run.status,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        summary: run.summary as Record<string, unknown>,
        error: run.error,
      }
    : null;

  const runRows = await listRuns(db, business.id, 10);
  const runs: RunView[] = runRows.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    mode: r.mode,
    status: r.status === "running" && Date.now() - r.startedAt.getTime() > STEWARD_RUN_LEASE_MS ? "stalled" : r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    summary: r.summary as Record<string, unknown>,
    error: r.error,
  }));

  const rawDecisions = await listRunDecisions(db, business.id, 25);
  const refs = await subjectRefs(db, business.id, rawDecisions.map((d) => d.subject));
  // each move told once, cash back from lending said as such, and stored blockers shown against what holds now (QA retest 18)
  const [lendingEvents, now] = await Promise.all([loadLendingEvents(db, business.vault), decisionNow(client, config.deployment, business.vault)]);
  const recentDecisions: DecisionView[] = foldRecentDecisions(rawDecisions, lendingEvents, now).map(({ row: d, summary, kindLabel, txHash }) => ({
    id: d.id,
    kind: d.kind,
    kindLabel,
    subject: d.subject,
    subjectLabel: d.subject ? (refs.get(d.subject)?.label ?? null) : null,
    subjectHref: d.subject ? (refs.get(d.subject)?.href ?? null) : null,
    txHash,
    createdAt: d.createdAt.toISOString(),
    summary,
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
        runningSince={inProgress?.startedAt.toISOString() ?? null}
        runs={runs}
        lastScheduledAt={scheduled?.startedAt.toISOString() ?? null}
        recentDecisions={recentDecisions}
        shadow={shadow}
        pendingAnchorCount={pendingAnchorCount}
        signer={signer}
        explorer={explorer}
      />
    </Shell>
  );
}

