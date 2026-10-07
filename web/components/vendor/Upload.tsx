"use client";

import { useState } from "react";
import type { FromFile, Prefill } from "@/lib/server/upload";
import { Composer, type ClientOption } from "./Composer";
import type { SignerPlan } from "@/components/setup/owner-signer";

type Reply = { ok: true; prefill: Prefill; fromFile: FromFile } | { ok: false; reason: string };

/**
 * Upload an invoice you already have (V5): a PDF or plain text goes to the reader, and what comes back is a draft in the composer for you
 * to check and change. The file isn't stored. Nothing is sealed until you sign the reviewed text.
 */
export function Upload(props: { available: boolean; handle: string; clients: ClientOption[]; nextNumber: string; signer: SignerPlan }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ prefill: Prefill; fromFile: FromFile; n: number } | null>(null);

  async function send(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/vendor/upload", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as Partial<Reply> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Something went wrong. Try again.");
      if (json.ok) setDraft((d) => ({ prefill: json.prefill!, fromFile: json.fromFile!, n: (d?.n ?? 0) + 1 }));
      else setProblem((json as { reason?: string }).reason ?? "Couldn’t read that file.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (draft) return <Composer key={draft.n} handle={props.handle} clients={props.clients} nextNumber={props.nextNumber} signer={props.signer} prefill={draft.prefill} fromFile={draft.fromFile} />;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-5xl leading-none">Upload an invoice</h1>
      <p className="mt-3 text-graphite">Already have one as a PDF? Upload it and Symbolon fills in a draft for you to check. Nothing is sealed until you review it and sign.</p>
      {props.available ? (
        <label
          className="mt-8 grid cursor-pointer place-items-center rounded-doc border-2 border-dashed border-rule px-6 py-14 text-center hover:border-ink/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void send(e.dataTransfer.files[0]);
          }}
        >
          <span>{busy ? "Reading the file…" : "Drop a PDF here, or choose one"}</span>
          <span className="mt-1 text-sm text-graphite">A PDF up to 8 MB, or a plain text file. It is read and not kept.</span>
          <input type="file" accept="application/pdf,text/plain,.pdf,.txt" className="sr-only" disabled={busy} onChange={(e) => void send(e.target.files?.[0])} />
        </label>
      ) : (
        <p role="status" className="mt-8 rounded-doc border border-rule p-4 text-sm text-graphite">
          Reading uploaded invoices isn’t available right now. You can write the invoice yourself.
        </p>
      )}
      {problem ? (
        <p role="alert" className="mt-4 text-sm text-red">
          {problem}
        </p>
      ) : null}
      <p className="mt-6 text-sm">
        <a href="/vendor/new" className="underline decoration-rule underline-offset-4">
          Write it yourself instead
        </a>
      </p>
    </div>
  );
}
