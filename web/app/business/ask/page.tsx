import { notFound } from "next/navigation";
import { AskView } from "@/components/ask/AskView";
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

  const config = getConfig();
  const typingAvailable = config.model !== undefined;

  const current = { kind: "business" as const, id: where.business.id };

  // the person's own stored thread (plan 05zf); a failure shows an empty thread with a note, never an error page
  let thread: Awaited<ReturnType<typeof loadThread>> = [];
  let earlier: Awaited<ReturnType<typeof listEarlier>> = [];
  let threadProblem = false;
  try {
    const db = await getDb();
    [thread, earlier] = await Promise.all([loadThread(db, where.business.id, session.user.id), listEarlier(db, where.business.id, session.user.id)]);
  } catch (e) {
    console.error("ask: the stored thread could not be loaded", e);
    threadProblem = true;
  }

  return (
    <Shell where={where} current={current}>
      <AskView
        businessId={where.business.id}
        businessName={where.business.name}
        quickQuestions={QUICK_QUESTIONS}
        typingAvailable={typingAvailable}
        initialThread={thread.map((m) => ({ question: m.question, answer: m.answer }))}
        threadProblem={threadProblem}
        initialEarlier={earlier}
      />
    </Shell>
  );
}
