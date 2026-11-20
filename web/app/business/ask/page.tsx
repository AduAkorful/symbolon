import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AskView } from "@/components/ask/AskView";
import { PageLoading } from "@/components/ui/PageLoading";
import { Shell } from "@/components/shell/Shell";
import { listEarlier, loadThread } from "@/lib/server/ask-store";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { QUICK_QUESTIONS } from "@/lib/server/intents/registry";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function BusinessAskPage() {
  const session = await requirePageSession("/business/ask");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <Suspense fallback={<PageLoading title="Ask Steward" shape="list" />}>
        <AskThread session={session} businessId={where.business.id} businessName={where.business.name} />
      </Suspense>
    </Shell>
  );
}

async function AskThread({ session, businessId, businessName }: { session: Awaited<ReturnType<typeof requirePageSession>>; businessId: string; businessName: string }) {
  const typingAvailable = getConfig().model !== undefined;
  let thread: Awaited<ReturnType<typeof loadThread>> = [];
  let earlier: Awaited<ReturnType<typeof listEarlier>> = [];
  let threadProblem = false;
  try {
    const db = await getDb();
    [thread, earlier] = await Promise.all([loadThread(db, businessId, session.user.id), listEarlier(db, businessId, session.user.id)]);
  } catch (e) {
    console.error("ask: the stored thread could not be loaded", e);
    threadProblem = true;
  }
  return (
    <AskView
      businessId={businessId}
      businessName={businessName}
      quickQuestions={QUICK_QUESTIONS}
      typingAvailable={typingAvailable}
      initialThread={thread.map((m) => ({ question: m.question, answer: m.answer, at: m.createdAt }))}
      threadProblem={threadProblem}
      initialEarlier={earlier}
    />
  );
}
