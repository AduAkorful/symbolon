"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress, zeroAddress } from "viem";
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
  // a half-typed address isn't an error yet: it is said once the field is left or the address is as long as one can be
  const [left, setLeft] = useState(false);
  // what is saved, said outright: an empty field with the wallet greyed in it can't be told from a placeholder (QA retest 3d)
  const [saved, setSaved] = useState<string | null>(initial);

  const typed = value.trim();
  const problem = typed === "" ? null : !isAddress(typed) ? "That isn't a valid address." : getAddress(typed) === zeroAddress ? "That is the empty address; nothing can be paid there." : null;

  const showProblem = problem !== null && (left || typed.length >= 42);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const r = await postJson<{ payoutAddress: string | null }>("/api/vendor/settings", { payoutAddress: value });
      setValue(r.payoutAddress ?? "");
      setSaved(r.payoutAddress);
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
      <Field label="Payout address on Arc" {...(showProblem ? { error: problem } : {})} hint="Leave it empty to be paid at your Seal’s wallet. Invoices you have already signed keep the address they were signed with.">
        {(a) => <input {...a} className={`${controlClass} font-mono`} value={value} onChange={(e) => { setValue(e.target.value); setLeft(false); }} onBlur={() => setLeft(true)} placeholder={sealAddress} spellCheck={false} />}
      </Field>
      <p className="text-sm text-graphite">
        {saved
          ? <>New invoices pay out to <span className="break-all font-mono text-ink">{saved}</span>.</>
          : <>New invoices pay out to your Seal’s own wallet, <span className="break-all font-mono text-ink">{sealAddress}</span>.</>}
      </p>
      {note ? (note.ok ? <p role="status" className="text-sm text-ok">{note.text}</p> : <InlineError>{note.text}</InlineError>) : null}
      <Button type="submit" busy={busy} disabled={problem !== null}>{busy ? "Saving…" : "Save"}</Button>
    </form>
  );
}
