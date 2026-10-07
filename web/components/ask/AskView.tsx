"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { buildHistory } from "@/lib/ask-history";

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
    <div className="flex min-h-[calc(100vh-10rem)] max-w-3xl flex-col">
      <div className="border-b border-rule pb-4">
        <h1 className="font-display text-4xl">Ask the Steward</h1>
        <p className="mt-1 text-sm text-graphite">
          Answers come directly from {businessName}’s real ledger, invoices, and decision records. Asking cannot move money.
        </p>
      </div>

      <ol className="mt-8 flex-1 space-y-6" aria-live="polite">
        {log.map((m, i) => (
          <li key={i} className="space-y-3">
            <p className="ml-auto w-fit max-w-[85%] rounded-doc bg-ink px-4 py-2.5 text-sm text-paper">
              {m.q}
            </p>
            {m.a ? (
              <div className="max-w-[90%] space-y-2 border-l-2 border-seal pl-4">
                <p className="text-sm leading-relaxed text-ink">{m.a.text}</p>
                {m.a.links && m.a.links.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1 text-xs">
                    {m.a.links.map(([label, href]) => (
                      <Link
                        key={href}
                        href={href}
                        className="rounded-doc border border-rule px-2.5 py-1 text-graphite hover:border-ink/50 hover:text-ink"
                      >
                        {label} →
                      </Link>
                    ))}
                  </div>
                ) : null}
                <p className="text-[11px] font-mono text-graphite">{m.a.source}</p>
              </div>
            ) : m.error ? (
              <div className="max-w-[90%] border-l-2 border-red pl-4">
                <p className="text-sm text-red">{m.error}</p>
              </div>
            ) : (
              <div className="max-w-[90%] border-l-2 border-rule pl-4 text-xs text-graphite">
                Consulting records…
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="mt-8 space-y-3 pt-4">
        {log.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLog([]);
                setInput("");
              }}
              className="text-xs text-graphite underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
            >
              New conversation
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {quickQuestions.map((q) => (
            <button
              key={q.intent + q.label}
              type="button"
              disabled={loading}
              onClick={() => askQuestion(q.label, q.intent, q.params)}
              className="rounded-full border border-rule px-3 py-1.5 text-xs text-graphite transition hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>

        {typingAvailable ? (
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            aria-label="Your question for the Steward"
            placeholder="Ask about invoices, payments, runway, holds…"
            className="w-full rounded-doc border border-rule bg-paper px-3.5 py-2.5 text-sm text-ink placeholder:text-graphite/60 focus:border-ink/50 focus:outline-none focus:ring-1 focus:ring-seal disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-doc bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-40"
          >
            Ask
          </button>
        </form>
        ) : null}
      </div>
    </div>
  );
}
