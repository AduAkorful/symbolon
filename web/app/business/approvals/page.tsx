import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { arcChain } from "@symbolon/chain";

import { ApprovalsClient } from "@/components/approvals/ApprovalsClient";
import { Shell } from "@/components/shell/Shell";
import { listApprovals } from "@/lib/server/approvals";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { businessOffers } from "@/lib/server/offers";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const session = await requirePageSession("/business/approvals");
  const where = await loadSpaces(session);
  const b = where.business;
  if (!b) {
    return notFound();
  }

  return (
    <Shell where={where} current={{ kind: "business", id: b.id }}>
      <Suspense fallback={<PageLoading title="Approvals" shape="list" />}>
        <ApprovalsContent session={session} businessId={b.id} />
      </Suspense>
    </Shell>
  );
}

/** The part of the page that reads Arc; the frame and title are already on screen while this finishes (plan 05zd F6) */
async function ApprovalsContent({ session, businessId }: { session: Awaited<ReturnType<typeof requirePageSession>>; businessId: string }) {
  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const data = await listApprovals(db, client, config, session.user, businessId);
  const offerViews = Object.fromEntries(await Promise.all(data.items.map(async (item) => [item.fingerprint, await businessOffers(db, session.user, businessId, item.fingerprint)])));
  const signerPlan = signerPlanFor(session, config);
  const explorerUrl = arcChain(config.chainId).blockExplorers!.default.url;

  return (
    <ApprovalsClient
      businessId={businessId}
      data={data}
      signerPlan={signerPlan}
      explorerUrl={explorerUrl}
      offerViews={offerViews}
    />
  );
}
