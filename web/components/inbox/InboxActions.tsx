"use client";

import { useState } from "react";

export function InboxActions({ businessId }: { businessId: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="space-y-4 rounded-doc border border-rule bg-paper-raised p-5">
      <div>
        <p className="font-medium">Add a sealed invoice</p>
        <form onSubmit={(e) => { e.preventDefault(); void addLink(e.currentTarget); }} className="mt-2 flex flex-wrap gap-2">
          <input name="link" placeholder="https://…/invoice/0x…" className="min-w-0 flex-1 rounded-doc border border-rule bg-paper px-3 py-2 text-sm" />
          <button disabled={busy} className="rounded-doc bg-ink px-3 py-2 text-sm text-paper disabled:opacity-50">Add link</button>
        </form>
        <label className="mt-2 inline-block text-sm underline decoration-rule underline-offset-4">
          Or choose a .symbolon file
          <input type="file" accept="application/json,.symbolon" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, `/api/business/${businessId}/inbox/upload`); }} />
        </label>
      </div>
      <div>
        <p className="font-medium">Add an unsigned bill</p>
        <p className="mt-1 text-sm text-graphite">It will be held and assessed. It can never be paid as uploaded.</p>
        <label className="mt-2 inline-block rounded-doc border border-rule px-3 py-2 text-sm">
          Choose PDF or text
          <input type="file" accept="application/pdf,text/plain,.txt" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, `/api/business/${businessId}/bills`); }} />
        </label>
      </div>
      {message ? <p role="status" className="text-sm text-red">{message}</p> : null}
    </div>
  );
}
