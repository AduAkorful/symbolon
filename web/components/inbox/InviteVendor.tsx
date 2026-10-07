"use client";

import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { moneyDraft } from "@/lib/money-draft";

/** The cap is typed in dollars and sent in the Vault's own units */
function capRaw(typed: string): string {
  const draft = moneyDraft(typed.trim().replace(/,/g, ""), 6);
  if (draft.error !== undefined) throw new Error(draft.error);
  return draft.raw.toString();
}

export function InviteVendor({ businessId }: { businessId: string }) {
  const [vendorName, setVendorName] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [monthlyCap, setMonthlyCap] = useState("");
  const [requirePo, setRequirePo] = useState(false);
  const [requireDelivery, setRequireDelivery] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError(""); setLink("");
    try { const result = await postJson<{ link: string }>(`/api/business/${businessId}/vendors`, { action: "invite", vendorName, contactNote, ...(monthlyCap.trim() ? { terms: { monthlyCap: capRaw(monthlyCap), requirePo, requireDelivery } } : {}) }); setLink(result.link); }
    catch (err) { setError(err instanceof Error ? err.message : "Couldn't create the invitation."); }
    finally { setBusy(false); }
  }}>
    <label className="grid gap-1 text-sm">Vendor name<input required maxLength={120} value={vendorName} onChange={(e) => setVendorName(e.target.value)} className="rounded border border-rule bg-paper px-3 py-2" /></label>
    <label className="grid gap-1 text-sm">Known contact / channel note<input required maxLength={160} value={contactNote} onChange={(e) => setContactNote(e.target.value)} placeholder="e.g. finance desk number on our contract" className="rounded border border-rule bg-paper px-3 py-2" /></label>
    <label className="grid gap-1 text-sm sm:col-span-2">Optional monthly cap in dollars<input inputMode="decimal" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} placeholder="Leave blank to set terms later, for example 5000.00" className="rounded border border-rule bg-paper px-3 py-2" /></label>
    {monthlyCap ? <div className="flex flex-wrap gap-4 text-sm sm:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" checked={requirePo} onChange={(e) => setRequirePo(e.target.checked)} />Require a PO</label><label className="flex items-center gap-2"><input type="checkbox" checked={requireDelivery} onChange={(e) => setRequireDelivery(e.target.checked)} />Require delivery</label></div> : null}
    <button disabled={busy} className="w-fit rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-60">{busy ? "Creating…" : "Create one-use link"}</button>
    <p className="text-xs text-graphite sm:col-span-2">Send the link only through the channel your business already trusts. The link is shown once and expires in 14 days.</p>
    {link ? <label className="grid gap-1 text-sm sm:col-span-2">Copy this secret link now<input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="rounded border border-rule bg-paper px-3 py-2 font-mono text-xs" /></label> : null}
    {error ? <p role="alert" className="text-sm text-red sm:col-span-2">{error}</p> : null}
  </form>;
}
