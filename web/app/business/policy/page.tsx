import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PolicyView } from "@/components/policy/PolicyView";
import { Shell } from "@/components/shell/Shell";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/States";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession, type CurrentSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { loadPolicyView } from "@/lib/server/policy-edit";
import { listBudgets } from "@/lib/server/budgets";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function BusinessPolicyPage() {
  const session = await requirePageSession("/business/policy");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  if (!where.business.vault) {
    return (
      <Shell where={where} current={{ kind: "business", id: where.business.id }}>
        <EmptyState
          title="This business has no Vault yet"
          action={<LinkButton href={`/setup?business=${where.business.id}`} size="sm">Finish setting up</LinkButton>}
        >
          The policy is set when the Vault is created, so there is nothing to edit until then.
        </EmptyState>
      </Shell>
    );
  }

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <Suspense fallback={<PageLoading title="Policy" shape="summary" />}>
        <PolicyContent session={session} businessId={where.business.id} businessName={where.business.name} isOwner={where.business.role === "owner"} />
      </Suspense>
    </Shell>
  );
}

async function PolicyContent({ session, businessId, businessName, isOwner }: { session: CurrentSession; businessId: string; businessName: string; isOwner: boolean }) {
  const config = getConfig();
  const db = await getDb();
  const [policyData, budgetsData] = await Promise.all([
    loadPolicyView(db, getClient(), config.deployment, session.user, businessId),
    listBudgets(db, getClient(), config.deployment, session.user, businessId),
  ]);
  const signer = signerPlanFor(session, config);
  return (
    <PolicyView
      {...policyData}
      businessId={businessId}
      businessName={businessName}
      isOwner={isOwner}
      signer={signer}
      budgets={budgetsData.budgets}
      explorerUrl={config.deployment.explorer}
    />
  );
}
