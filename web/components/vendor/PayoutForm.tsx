"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";

/** The payout address new invoices start with. Blank means your Seal's own wallet. */
export function PayoutForm({ initial, sealAddress }: { initial: string | null; sealAddress: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const r = await postJson<{ payoutAddress: string | null }>("/api/vendor/settings", { payoutAddress: value });
      setValue(r.payoutAddress ?? "");
      setNote({ ok: true, text: r.payoutAddress ? "Saved. New invoices will pay out here." : "Saved. New invoices will pay out to your Seal’s wallet." });
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-xl space-y-4">
      <Field label="Payout address on Arc" hint="Leave it empty to be paid at your Seal’s wallet. Invoices you have already signed keep the address they were signed with.">
        {(a) => <input {...a} className={`${controlClass} font-mono`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={sealAddress} spellCheck={false} />}
      </Field>
      {note ? (note.ok ? <p role="status" className="text-sm text-ok">{note.text}</p> : <InlineError>{note.text}</InlineError>) : null}
      <Button type="submit" busy={busy}>{busy ? "Saving…" : "Save"}</Button>
    </form>
  );
}
