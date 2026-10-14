"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { Field, controlClass, textareaClass } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { postJson } from "@/lib/client/api";

/** Kept in step with `DECLINE_REASONS` in `lib/server/invoice-decline.ts` (the server checks the code it is sent) */
const REASONS: { code: string; label: string }[] = [
  { code: "duplicate", label: "It looks like a duplicate of another invoice" },
  { code: "wrong_amount", label: "The amount isn't what we agreed" },
  { code: "not_recognised", label: "We don't recognise this invoice or the work" },
  { code: "wrong_details", label: "The invoice details need correcting" },
  { code: "other", label: "Something else" },
];

/**
 * "We won't pay this" (plan 05zn). Offchain: nothing is sent to the Vault or the ledger. The vendor is told the reason, the
 * Steward stops considering the invoice, and the owner can reopen it.
 */
export function DeclineInvoice({ businessId, fingerprint }: { businessId: string; fingerprint: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("duplicate");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/business/${businessId}/inbox`, { action: "decline", fingerprint, reason, note });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't decline this invoice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Decline this invoice…</Button>
      {open ? (
        <Overlay
          title="Decline this invoice"
          description="You won't pay it. The vendor is told why and can send a corrected one. Nothing is sent to the Vault, and you can reopen it later."
          onClose={() => (busy ? undefined : setOpen(false))}
        >
          <div className="space-y-4">
            <Field label="Reason">
              {(a) => (
                <select {...a} className={controlClass} value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              )}
            </Field>
            <Field label={reason === "other" ? "What's the reason?" : "Add a note (optional)"} hint="The vendor sees this.">
              {(a) => <textarea {...a} className={textareaClass} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {error ? <InlineError>{error}</InlineError> : null}
          </div>
          <Overlay.Footer>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void submit()} busy={busy}>{busy ? "Declining…" : "Decline invoice"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </>
  );
}

/** Puts a declined invoice back to "checked"; the Steward looks at it again on its next run */
export function ReopenInvoice({ businessId, fingerprint }: { businessId: string; fingerprint: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/business/${businessId}/inbox`, { action: "reopen", fingerprint });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reopen this invoice.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span>
      <Button size="sm" variant="secondary" onClick={() => void reopen()} busy={busy}>{busy ? "Reopening…" : "Reopen"}</Button>
      {error ? <span className="ml-3 text-sm text-red">{error}</span> : null}
    </span>
  );
}
