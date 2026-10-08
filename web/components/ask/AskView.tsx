"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { buildHistory } from "@/lib/ask-history";
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
}

interface Message {
  q: string;
  a?: AskAnswer;
  error?: string;
}

export function AskView({
  businessId,
  businessName,
  quickQuestions,
  typingAvailable,
}: {
  businessId: string;
  businessName: string;
  quickQuestions: QuickQuestion[];
  typingAvailable: boolean;
}) {
  const [log, setLog] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function askQuestion(questionText: string, intent?: string, params?: Record<string, unknown>) {
    if (!questionText.trim() || loading) return;
    setLoading(true);

    const newIndex = log.length;
    setLog((prev) => [...prev, { q: questionText }]);
    setInput("");

    try {
      const res = await postJson<{ ok: boolean; answer: AskAnswer }>(
        `/api/business/${businessId}/ask`,
        intent ? { intent, params } : { question: questionText, history: buildHistory(log) },
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
        <Lead className="mt-3">Answers come straight from {businessName}’s ledger, invoices and decision records. Asking can’t move money.</Lead>
      </div>

      <div className="flex min-h-[28rem] min-w-0 flex-col">
        <ol className="flex-1 space-y-6" aria-live="polite">
          {log.length === 0 ? (
            <li className="text-graphite">Pick a question, or type your own below. Answers cite where they come from.</li>
          ) : null}
          {log.map((m, i) => (
            <li key={i} className="space-y-3">
              <p className="ml-auto w-fit max-w-[85%] rounded-doc bg-ink px-4 py-2.5 text-paper">{m.q}</p>
              {m.a ? (
                <div className="max-w-[90%] space-y-2 border-l-2 border-seal pl-4">
                  <p className="leading-relaxed text-ink">{m.a.text}</p>
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
                </div>
              ) : m.error ? (
                <div className="max-w-[90%] border-l-2 border-red pl-4">
                  <p className="text-red">{m.error}</p>
                </div>
              ) : (
                <div className="max-w-[90%] border-l-2 border-rule pl-4"><InlineLoading>Looking through the records…</InlineLoading></div>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-8 space-y-3">
          {log.length > 0 ? (
            <div className="flex justify-end">
              <Button variant="quiet" size="sm" disabled={loading} onClick={() => { setLog([]); setInput(""); }}>New conversation</Button>
            </div>
          ) : null}
          {typingAvailable ? (
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
      </aside>
    </div>
  );
}
