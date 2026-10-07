import { notFound } from "next/navigation";
import { AskView } from "@/components/ask/AskView";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { requirePageSession } from "@/lib/server/http";
import { QUICK_QUESTIONS } from "@/lib/server/intents/registry";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function BusinessAskPage() {
  const session = await requirePageSession("/business/ask");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const typingAvailable = config.model !== undefined;

  const current = { kind: "business" as const, id: where.business.id };

  return (
    <Shell where={where} current={current}>
      <AskView
        businessId={where.business.id}
        businessName={where.business.name}
        quickQuestions={QUICK_QUESTIONS}
        typingAvailable={typingAvailable}
      />
    </Shell>
  );
}
