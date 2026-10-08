import { notFound } from "next/navigation";
import { Suspense } from "react";
import { arcChain, symbolonContracts } from "@symbolon/chain";
import { AccountingView } from "@/components/accounting/AccountingView";
import { Shell } from "@/components/shell/Shell";
import { loadAccounting } from "@/lib/server/accounting";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function BusinessAccountingPage() {
  const session = await requirePageSession("/business/accounting");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <Suspense fallback={<PageLoading title="Accounting" shape="summary" />}>
        <AccountingContent session={session} businessId={where.business.id} />
      </Suspense>
    </Shell>
  );
}

/** The part of the page that reads Arc; the frame and title are already on screen while this finishes (plan 05zd F6) */
async function AccountingContent({ session, businessId }: { session: Awaited<ReturnType<typeof requirePageSession>>; businessId: string }) {
  const config = getConfig();
  const db = await getDb();
  const client = getClient();
  const contracts = symbolonContracts(client, config.deployment);
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;

  const data = await loadAccounting(db, contracts, client, config.deployment, session.user, businessId);

  return <AccountingView initialData={data} businessId={businessId} explorer={explorer} />;
}
