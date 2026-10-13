"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { postJson } from "@/lib/client/api";

/**
 * The name on invoices and the website (plan 05zj F, SYM-33). The handle stays read-only because it is part of public links.
 * Invoices already sealed keep the name they were signed with.
 */
export function ProfileForm({ initialName, initialWebsite, handle }: { initialName: string; initialWebsite: string | null; handle: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [website, setWebsite] = useState(initialWebsite ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const nameProblem = name.trim().length < 2 || name.trim().length > 80 ? "2 to 80 characters." : null;
  const websiteProblem = website.trim() !== "" && (website.trim().length < 3 || website.trim().length > 200) ? "3 to 200 characters, or leave it empty." : null;
  const unchanged = name.trim() === initialName && website.trim() === (initialWebsite ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const r = await postJson<{ displayName: string; website: string | null }>("/api/vendor/settings", { action: "profile", displayName: name, website });
      setName(r.displayName);
      setWebsite(r.website ?? "");
      setNote({ ok: true, text: "Saved. New invoices use this name. Ones you have already sealed keep theirs." });
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-xl space-y-4">
      <Field label="Name on invoices" {...(nameProblem ? { error: nameProblem } : {})}>
        {(a) => <input {...a} className={controlClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}
      </Field>
      <Field label="Website" {...(websiteProblem ? { error: websiteProblem } : {})}>
        {(a) => <input {...a} className={controlClass} value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={200} placeholder="studio-ana.com" />}
      </Field>
      <p className="text-sm text-graphite">Handle: <span className="font-mono">@{handle}</span>. It is part of your public invoice links, so it can’t be changed.</p>
      {note ? (note.ok ? <p role="status" className="text-sm text-ok">{note.text}</p> : <InlineError>{note.text}</InlineError>) : null}
      <Button type="submit" busy={busy} disabled={unchanged || nameProblem !== null || websiteProblem !== null}>{busy ? "Saving…" : "Save"}</Button>
    </form>
  );
}
