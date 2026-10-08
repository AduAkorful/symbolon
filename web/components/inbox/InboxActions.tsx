"use client";

import { useRef, useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";

/** The inbox's one "Add" control: a button that opens a dialog for a sealed invoice (link or file) or an unsigned bill (file) */
export function InboxActions({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const sealedFile = useRef<HTMLInputElement>(null);
  const billFile = useRef<HTMLInputElement>(null);

  async function addLink(form: HTMLFormElement) {
    const data = new FormData(form);
    const link = String(data.get("link") ?? "").trim();
    const fingerprint = link.match(/\/invoice\/(0x[0-9a-f]{64})$/i)?.[1];
    if (!fingerprint) { setMessage("Paste a Symbolon invoice link from this deployment."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/business/${businessId}/inbox`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add", fingerprint: fingerprint.toLowerCase() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "That invoice couldn't be added.");
      window.location.assign(`/business/inbox/${body.fingerprint}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "That invoice couldn't be added."); }
    finally { setBusy(false); }
  }

  async function upload(file: File, endpoint: string) {
    const form = new FormData(); form.set("file", file);
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The upload failed.");
      window.location.reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : "The upload failed."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Button onClick={() => { setMessage(""); setOpen(true); }}>Add to the inbox</Button>

      {open ? (
        <Overlay title="Add to the inbox" description="Sealed invoices are checked against the vendor’s Seal. Anything else is held and can never be paid as uploaded." onClose={() => { if (!busy) setOpen(false); }}>
          <form onSubmit={(e) => { e.preventDefault(); void addLink(e.currentTarget); }} className="space-y-3">
            <Field label="A sealed invoice" hint="Paste the link the vendor sent you.">
              {(a) => <input {...a} name="link" placeholder="https://…/invoice/0x…" className={controlClass} />}
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" busy={busy}>Add the invoice</Button>
              <input ref={sealedFile} type="file" accept="application/json,.symbolon" className="sr-only" tabIndex={-1} aria-label="Choose a .symbolon file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, `/api/business/${businessId}/inbox/upload`); }} />
              <Button variant="secondary" disabled={busy} onClick={() => sealedFile.current?.click()}>Or choose a .symbolon file</Button>
            </div>
          </form>

          <div className="space-y-2 border-t border-rule pt-4">
            <p className="font-medium text-ink">An unsigned bill</p>
            <p className="text-graphite">A PDF or text file without a Seal. It is held, assessed, and can’t be paid.</p>
            <input ref={billFile} type="file" accept="application/pdf,text/plain,.txt" className="sr-only" tabIndex={-1} aria-label="Choose a PDF or text file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, `/api/business/${businessId}/bills`); }} />
            <Button variant="secondary" disabled={busy} onClick={() => billFile.current?.click()}>Choose a PDF or text file</Button>
          </div>

          {message ? <InlineError>{message}</InlineError> : null}
        </Overlay>
      ) : null}
    </>
  );
}
