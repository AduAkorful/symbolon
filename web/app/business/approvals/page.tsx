import Link from "next/link";
import { notFound } from "next/navigation";

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

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const session = await requirePageSession("/business/approvals");
  const where = await loadSpaces(session);
  const b = where.business;
  if (!b) {
    return notFound();
  }

  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const data = await listApprovals(db, client, config, session.user, b.id);
  const offerViews = Object.fromEntries(await Promise.all(data.items.map(async (item) => [item.fingerprint, await businessOffers(db, session.user, b.id, item.fingerprint)])));
  const signerPlan = signerPlanFor(session, config);
  const explorerUrl = arcChain(config.chainId).blockExplorers!.default.url;

  return (
    <Shell where={where} current={{ kind: "business", id: b.id }}>
      <ApprovalsClient
        businessId={b.id}
        data={data}
        signerPlan={signerPlan}
        explorerUrl={explorerUrl}
        offerViews={offerViews}
      />
    </Shell>
  );
}
