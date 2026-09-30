import { notFound } from "next/navigation";
import { arcChain } from "@symbolon/chain";

import { ComplianceView } from "@/components/compliance/ComplianceView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { loadComplianceView } from "@/lib/server/compliance";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function BusinessCompliancePage() {
  const session = await requirePageSession("/business/compliance");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;

  const model = await loadComplianceView(
    db,
    getClient(),
    config.deployment,
    session.user,
    where.business.id,
  );
  const signer = await signerPlanFor(session.user, config);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <ComplianceView model={model} signer={signer} explorer={explorer} />
    </Shell>
  );
}
