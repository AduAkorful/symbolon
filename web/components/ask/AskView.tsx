"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { useConfirm } from "@/components/useConfirm";
import { formatDay } from "@/lib/format";
import { Button, buttonClass } from "@/components/ui/button";
import { InlineLoading } from "@/components/ui/States";
import { Lead, PageTitle, SmallTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";

export interface QuickQuestion {
  label: string;
  intent: string;
  params: Record<string, unknown>;
}

export interface AskAnswer {
  text: string;
  links: [string, string][];
  source: string;
  intent: string;
  /** The parameters the question ran with; they travel back as part of the conversation */
  params?: Record<string, unknown>;
  /** For a conversational reply: what the lookups behind it said */
  facts?: { text: string; source: string }[];
  /** False when this exchange could not be kept for the next visit */
  saved?: false;
}

export interface EarlierItem {
  id: string;
  title: string;
  messages: number;
  lastAt: string;
}

interface Message {
  q: string;
  a?: AskAnswer;
  error?: string;
}


/** One question and what the person was shown for it */
function Exchange({ m }: { m: Message }) {
  return (
<li className="space-y-3">
        <p className="ml-auto w-fit max-w-[85%] rounded-doc bg-ink px-4 py-2.5 text-paper">{m.q}</p>
        {m.a ? (
          <div className="max-w-[90%] space-y-2 border-l-2 border-seal pl-4">
            <p className="whitespace-pre-line leading-relaxed text-ink">{m.a.text}</p>
            {m.a.facts && m.a.facts.length > 0 ? (
              <details className="text-sm text-graphite">
                <summary className="cursor-pointer select-none hover:text-ink">Show the numbers</summary>
                <ul className="mt-2 space-y-2 border-l border-rule pl-3">
                  {m.a.facts.map((f, k) => (
                    <li key={k}>
                      <p className="whitespace-pre-line text-ink">{f.text}</p>
                      <p>{f.source}</p>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {m.a.links && m.a.links.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {m.a.links.map(([label, href]) => (
                  <Link key={href} href={href} className={buttonClass({ variant: "secondary", size: "sm" })}>
                    {label} →
                  </Link>
                ))}
              </div>
            ) : null}
            <p className="text-sm text-graphite">{m.a.source}</p>
            {m.a.saved === false ? <p className="text-sm text-warn">This one wasn’t saved, so it won’t be here after a refresh.</p> : null}
          </div>
        ) : m.error ? (
          <div className="max-w-[90%] border-l-2 border-red pl-4">
            <p className="text-red">{m.error}</p>
          </div>
        ) : (
          <div className="max-w-[90%] border-l-2 border-rule pl-4"><InlineLoading>Looking through the records…</InlineLoading></div>
        )}
      </li>
  );
}

export function AskView({
  businessId,
  businessName,
  quickQuestions,
  typingAvailable,
  initialThread,
  threadProblem,
  initialEarlier,
}: {
  businessId: string;
  businessName: string;
  quickQuestions: QuickQuestion[];
  typingAvailable: boolean;
  /** The person's stored thread (plan 05zf), oldest first */
  initialThread: { question: string; answer: AskAnswer }[];
  /** Set when the stored thread could not be loaded */
  threadProblem?: boolean;
  /** The person's earlier conversations, newest first (plan 05zf amendment) */
  initialEarlier: EarlierItem[];
}) {
  const [log, setLog] = useState<Message[]>(() => initialThread.map((m) => ({ q: m.question, a: m.answer })));
  const [confirmAsk, confirmDialog] = useConfirm();
  const [problem, setProblem] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<EarlierItem[]>(initialEarlier);
  const [viewing, setViewing] = useState<{ id: string; title: string; messages: Message[] } | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function askQuestion(questionText: string, intent?: string, params?: Record<string, unknown>) {
    if (!questionText.trim() || loading) return;
    setViewing(null); // asking from a quick question while reading an earlier conversation goes back to the current one
    setLoading(true);

    const newIndex = log.length;
    setLog((prev) => [...prev, { q: questionText }]);
    setInput("");

    try {
      const res = await postJson<{ ok: boolean; answer: AskAnswer }>(
        `/api/business/${businessId}/ask`,
        // the server keeps the conversation and reads it back itself; the label is only what gets stored for a quick question
        intent ? { intent, params, question: questionText } : { question: questionText },
      );
      setLog((prev) =>
        prev.map((msg, i) => (i === newIndex ? { ...msg, a: res.answer } : msg)),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Couldn't reach the Steward.";
      setLog((prev) =>
        prev.map((msg, i) => (i === newIndex ? { ...msg, error: errMsg } : msg)),
      );
    } finally {
      setLoading(false);
    }
  }

  /** "New conversation": the current thread moves to the list of earlier conversations; nothing is deleted */
  async function newConversation() {
    setProblem(null);
    try {
      const res = await postJson<{ earlier: EarlierItem[] }>(`/api/business/${businessId}/ask/conversations`);
      setEarlier(res.earlier);
      setLog([]);
      setInput("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't start a new conversation. Try again.");
    }
  }

  async function openEarlier(item: EarlierItem) {
    setProblem(null);
    try {
      const res = await fetch(`/api/business/${businessId}/ask/conversations/${item.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't open that conversation.");
      const data = (await res.json()) as { messages: { question: string; answer: AskAnswer }[] };
      setViewing({ id: item.id, title: item.title, messages: data.messages.map((m) => ({ q: m.question, a: m.answer })) });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't open that conversation.");
    }
  }

  async function deleteViewed() {
    if (!viewing) return;
    if (!(await confirmAsk({ title: "Delete this conversation?", body: "It is removed for good. Your current conversation isn't touched.", confirmLabel: "Delete it", destructive: true }))) return;
    setProblem(null);
    try {
      const res = await fetch(`/api/business/${businessId}/ask/conversations/${viewing.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete that conversation. Try again.");
      const data = (await res.json()) as { earlier: EarlierItem[] };
      setEarlier(data.earlier);
      setViewing(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't delete that conversation. Try again.");
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim()) {
      askQuestion(input.trim());
    }
  }

  return (
    <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 border-b border-rule pb-6 xl:col-span-2">
        <PageTitle>Ask the Steward</PageTitle>
        <Lead className="mt-3">Ask in your own words. Answers come from {businessName}’s ledger, invoices and decision records, and say where they came from. Asking can’t move money.</Lead>
      </div>

      <div className="flex min-h-[28rem] min-w-0 flex-col">
        {viewing ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-doc border border-rule px-4 py-3 text-sm">
            <p className="text-graphite">An earlier conversation, read only.</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setViewing(null)}>Back to this conversation</Button>
              <Button variant="quiet" size="sm" onClick={() => void deleteViewed()}>Delete</Button>
            </div>
          </div>
        ) : null}
        <ol className="flex-1 space-y-6" aria-live="polite">
          {threadProblem && !viewing ? <li className="text-sm text-warn">Couldn’t load your earlier messages. New ones will still be saved.</li> : null}
          {!viewing && log.length === 0 ? (
            <li className="text-graphite">Say hello, ask a question, or pick one on the right. Try “What should I do next?”</li>
          ) : null}
          {(viewing ? viewing.messages : log).map((m, i) => (
            <Exchange key={i} m={m} />
          ))}
        </ol>

        {confirmDialog}
        <div className="mt-8 space-y-3">
          {problem ? <p className="text-sm text-red" role="alert">{problem}</p> : null}
          {!viewing && log.length > 0 ? (
            <div className="flex justify-end">
              <Button variant="quiet" size="sm" disabled={loading} onClick={() => void newConversation()}>New conversation</Button>
            </div>
          ) : null}
          {viewing ? null : typingAvailable ? (
            <form onSubmit={handleFormSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                aria-label="Your question for the Steward"
                placeholder="Ask about invoices, payments, runway, holds…"
                className={controlClass}
              />
              <Button type="submit" busy={loading} disabled={!input.trim()}>Ask</Button>
            </form>
          ) : (
            <p className="text-sm text-graphite">Typing your own question isn’t switched on for this deployment. The questions here work without it.</p>
          )}
        </div>
      </div>

      <aside aria-labelledby="try-heading" className="min-w-0 xl:row-start-2 xl:col-start-2">
        <SmallTitle id="try-heading" as="h2">Questions to try</SmallTitle>
        <ul className="mt-3 flex flex-wrap gap-2 xl:flex-col xl:items-stretch">
          {quickQuestions.map((q) => (
            <li key={q.intent + q.label} className="xl:w-full">
              <Button variant="secondary" size="sm" className="xl:w-full xl:justify-start xl:whitespace-normal xl:text-left" disabled={loading} onClick={() => askQuestion(q.label, q.intent, q.params)}>
                {q.label}
              </Button>
            </li>
          ))}
        </ul>
        {earlier.length > 0 ? (
          <div className="mt-8">
            <SmallTitle as="h2">Earlier conversations</SmallTitle>
            <ul className="mt-3 flex flex-col gap-2">
              {earlier.map((e) => (
                <li key={e.id}>
                  <Button variant="quiet" size="sm" className="w-full justify-start whitespace-normal text-left" disabled={loading} onClick={() => void openEarlier(e)}>
                    <span className="block min-w-0">
                      <span className="block truncate">{e.title}</span>
                      <span className="block text-xs text-graphite">{formatDay(e.lastAt, { year: "always" })} · {e.messages} {e.messages === 1 ? "message" : "messages"}</span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
