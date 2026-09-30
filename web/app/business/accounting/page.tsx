import { notFound } from "next/navigation";
import { arcChain, symbolonContracts } from "@symbolon/chain";
import { AccountingView } from "@/components/accounting/AccountingView";
import { Shell } from "@/components/shell/Shell";
import { loadAccounting } from "@/lib/server/accounting";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function BusinessAccountingPage() {
  const session = await requirePageSession("/business/accounting");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();
  const client = getClient();
  const contracts = symbolonContracts(client, config.deployment);
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;

  const data = await loadAccounting(
    db,
    contracts,
    client,
    config.deployment,
    session.user,
    where.business.id,
  );

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <AccountingView initialData={data} businessId={where.business.id} explorer={explorer} />
    </Shell>
  );
}
