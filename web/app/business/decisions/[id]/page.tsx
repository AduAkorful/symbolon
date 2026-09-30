import { notFound } from "next/navigation";

import { arcChain } from "@symbolon/chain";

import { DecisionView } from "@/components/decisions/DecisionView";
import { Shell } from "@/components/shell/Shell";
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

  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const decision = await loadDecision(db, client, config, session.user, b.id, id);
  if (!decision) return notFound();

  const explorerUrl = arcChain(config.chainId).blockExplorers!.default.url;

  return (
    <Shell where={where} current={{ kind: "business", id: b.id }}>
      <DecisionView decision={decision} explorerUrl={explorerUrl} />
    </Shell>
  );
}
