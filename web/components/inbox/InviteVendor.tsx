"use client";

import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { postJson } from "@/lib/client/api";
import { moneyDraft } from "@/lib/money-draft";

/** The cap is typed in dollars and sent in the Vault's own units */
function capRaw(typed: string): string {
  const draft = moneyDraft(typed.trim().replace(/,/g, ""), 6);
  if (draft.error !== undefined) throw new Error(draft.error);
  return draft.raw.toString();
}

/** Invite a vendor: a button that opens a dialog. The one-use link is shown once, inside it, after it is created. */
export function InviteVendor({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [monthlyCap, setMonthlyCap] = useState("");
  const [requirePo, setRequirePo] = useState(false);
  const [requireDelivery, setRequireDelivery] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    if (link) window.location.reload();
  };

  return (
    <>
      <Button onClick={() => { setLink(""); setError(""); setOpen(true); }}>Invite a vendor</Button>
      {open ? (
        <Overlay
          title={link ? "Send this link to the vendor" : "Invite a vendor"}
          description={link ? "Send it only through a channel your business already trusts. It is shown once and expires in 14 days." : "They get a one-use link to create their Seal and sign their first invoice to you."}
          onClose={close}
        >
          {link ? (
            <>
              <Field label="Secret link">
                {(a) => <input {...a} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${controlClass} font-mono`} />}
              </Field>
              <p className="text-graphite">If you lose it, withdraw the invitation and create a new one.</p>
              <Overlay.Footer>
                <Button onClick={close}>Done</Button>
              </Overlay.Footer>
            </>
          ) : (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault(); setBusy(true); setError("");
                try {
                  const result = await postJson<{ link: string }>(`/api/business/${businessId}/vendors`, { action: "invite", vendorName, contactNote, ...(monthlyCap.trim() ? { terms: { monthlyCap: capRaw(monthlyCap), requirePo, requireDelivery } } : {}) });
                  setLink(result.link);
                } catch (err) { setError(err instanceof Error ? err.message : "Couldn't create the invitation."); }
                finally { setBusy(false); }
              }}
            >
              {error ? <InlineError>{error}</InlineError> : null}
              <Field label="Vendor name">
                {(a) => <input {...a} required maxLength={120} value={vendorName} onChange={(e) => setVendorName(e.target.value)} className={controlClass} />}
              </Field>
              <Field label="How you know them" hint="A contact or channel you already trusted, such as the finance desk number on your contract.">
                {(a) => <input {...a} required maxLength={160} value={contactNote} onChange={(e) => setContactNote(e.target.value)} className={controlClass} />}
              </Field>
              <Field label="Monthly cap, in dollars" optional hint="Leave it empty to set the terms later, for example 5000.00.">
                {(a) => <input {...a} inputMode="decimal" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} className={controlClass} />}
              </Field>
              {monthlyCap ? (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requirePo} onChange={(e) => setRequirePo(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require a purchase order</label>
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requireDelivery} onChange={(e) => setRequireDelivery(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require delivery</label>
                </div>
              ) : null}
              <Overlay.Footer>
                <Button variant="secondary" onClick={close}>Cancel</Button>
                <Button type="submit" busy={busy}>{busy ? "Creating…" : "Create the link"}</Button>
              </Overlay.Footer>
            </form>
          )}
        </Overlay>
      ) : null}
    </>
  );
}
