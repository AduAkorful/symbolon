import { notFound } from "next/navigation";

import { PolicyView } from "@/components/policy/PolicyView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { loadPolicyView } from "@/lib/server/policy-edit";
import { listBudgets } from "@/lib/server/budgets";

export const dynamic = "force-dynamic";

export default async function BusinessPolicyPage() {
  const session = await requirePageSession("/business/policy");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();

  const [policyData, budgetsData] = await Promise.all([
    loadPolicyView(
      db,
      getClient(),
      config.deployment,
      session.user,
      where.business.id,
    ),
    listBudgets(
      db,
      getClient(),
      config.deployment,
      session.user,
      where.business.id,
    ),
  ]);

  const signer = await signerPlanFor(session, config);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <PolicyView
        {...policyData}
        businessId={where.business.id}
        businessName={where.business.name}
        isOwner={where.business.role === "owner"}
        signer={signer}
        budgets={budgetsData.budgets}
        explorerUrl={config.deployment.explorer}
      />
    </Shell>
  );
}
