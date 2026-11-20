import { Suspense } from "react";
import { notFound } from "next/navigation";

import { arcChain } from "@symbolon/chain";

import { DecisionView } from "@/components/decisions/DecisionView";
import { Shell } from "@/components/shell/Shell";
import { PageLoading } from "@/components/ui/PageLoading";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { loadDecision } from "@/lib/server/decisions";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function DecisionPage({ params }: Props) {
  const { id } = await params;
  const session = await requirePageSession(`/business/decisions/${id}`);
  const where = await loadSpaces(session);
  const b = where.business;
  if (!b) return notFound();

  return (
    <Shell where={where} current={{ kind: "business", id: b.id }}>
      <Suspense fallback={<PageLoading title="Decision" shape="summary" />}>
        <DecisionBody session={session} businessId={b.id} id={id} />
      </Suspense>
    </Shell>
  );
}

async function DecisionBody({ session, businessId, id }: { session: Awaited<ReturnType<typeof requirePageSession>>; businessId: string; id: string }) {
  const decision = await loadDecision(await getDb(), getClient(), getConfig(), session.user, businessId, id);
  if (!decision) return notFound();
  return <DecisionView decision={decision} explorerUrl={arcChain(getConfig().chainId).blockExplorers!.default.url} />;
}
