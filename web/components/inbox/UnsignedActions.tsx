"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";

/** What a member can do with an unsigned bill (plan 05j, B8). Paying it is not among them: unsigned documents are never payable. */
export function UnsignedActions({ businessId, billId, status, role }: { businessId: string; billId: string; status: string; role: string }) {
  const router = useRouter();
  const [vendorName, setVendorName] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/business/${businessId}/bills/${billId}`;
  const resolvable = (status === "open" || status === "invited") && (role === "owner" || role === "approver");

  async function act(body: Record<string, unknown>, then: (r: { link?: string }) => void) {
    setBusy(true); setError("");
    try { then(await postJson<{ link?: string }>(url, body)); }
    catch (e) { setError(e instanceof Error ? e.message : "That didn't work. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-8 space-y-6">
      <div>
        <SectionTitle>What you can do</SectionTitle>
        <p className="mt-2 text-sm text-graphite">The way forward is a sealed invoice from the sender. Paying this file as a manual payment comes with paying, and is not available yet.</p>
      </div>
      {role === "owner" && (status === "open" || status === "invited") ? (
        <form className="grid gap-3 rounded-doc border border-rule p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void act({ action: "ask", vendorName, contactNote }, (r) => { setLink(r.link ?? ""); router.refresh(); }); }}>
          <h3 className="font-medium sm:col-span-2">Ask for a sealed invoice</h3>
          <label className="grid gap-1 text-sm">Vendor name<input required maxLength={120} value={vendorName} onChange={(e) => setVendorName(e.target.value)} className={controlClass} /></label>
          <label className="grid gap-1 text-sm">A contact your business already had<input required maxLength={160} value={contactNote} onChange={(e) => setContactNote(e.target.value)} placeholder="e.g. finance desk number on our contract" className={controlClass} /></label>
          <p className="text-xs text-graphite sm:col-span-2">Type the contact yourself. Nothing from this bill, such as its email or phone number, is offered here, because the bill is the thing we can't trust. Send the one-use link only over a channel you already trust.</p>
          <button disabled={busy} className={buttonClass({ className: "w-fit" })}>{busy ? "Creating…" : "Create one-use link"}</button>
          {link ? <label className="grid gap-1 text-sm sm:col-span-2">Copy this secret link now<input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${controlClass} font-mono`} /></label> : null}
        </form>
      ) : null}
      {resolvable ? (
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => void act({ action: "fraud" }, () => router.refresh())} className={buttonClass({ variant: "danger" })}>Mark as fraud</button>
          <button disabled={busy} onClick={() => void act({ action: "dismiss" }, () => router.refresh())} className={buttonClass({ variant: "secondary" })}>Dismiss</button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red">{error}</p> : null}
    </section>
  );
}
