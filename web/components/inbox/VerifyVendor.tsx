"use client";

import { useState } from "react";
import { postJson } from "@/lib/client/api";

export function VerifyVendor({ businessId, seal, verificationId, awaitingSecond }: { businessId: string; seal: string; verificationId?: string; awaitingSecond?: boolean }) {
  const [id, setId] = useState(verificationId ?? "");
  const [code, setCode] = useState("");
  const [contacted, setContacted] = useState("");
  const [channel, setChannel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = `/api/business/${businessId}/verification`;
  async function start() {
    setBusy(true); setMessage("");
    try { const result = await postJson<{ id: string }>(endpoint, { action: "start", seal }); setId(result.id); setMessage("Ask the vendor to open Checks in their Symbolon account. Use a contact your business already trusted before this invoice."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't start verification."); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setMessage("");
    try { const result = await postJson<{ status: string }>(endpoint, { action: "code", requestId: id, code, contacted, channel }); setMessage(result.status === "awaiting_second" ? "A second owner or approver must confirm; verification is not complete yet." : "Verified. Payee setup remains a separate owner-signed Vault action."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't check that code."); }
    finally { setBusy(false); }
  }
  async function second() {
    setBusy(true); setMessage("");
    try { await postJson(endpoint, { action: "second", requestId: id }); setMessage("Second confirmation recorded. The vendor is verified; adding them as a payee is still separate."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't confirm."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 max-w-[460px] rounded border border-rule p-3">
    {awaitingSecond ? <button onClick={second} disabled={busy} className="rounded border border-rule px-3 py-1.5 text-xs">{busy ? "Recording…" : "Confirm as second person"}</button> : !id ? <button onClick={start} disabled={busy} className="rounded border border-rule px-3 py-1.5 text-xs">{busy ? "Starting…" : "Verify by trusted callback"}</button> : <div className="grid gap-2">
      <p className="text-xs text-graphite">Do not use contact details from the invoice, its email, or the Seal profile. Record who you reached and the channel.</p>
      <label className="grid gap-1 text-xs">Six-digit code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className="rounded border border-rule bg-paper px-2 py-2 font-mono" /></label>
      <label className="grid gap-1 text-xs">Person reached<input maxLength={120} value={contacted} onChange={(e) => setContacted(e.target.value)} className="rounded border border-rule bg-paper px-2 py-2" /></label>
      <label className="grid gap-1 text-xs">Trusted channel used<input maxLength={120} value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded border border-rule bg-paper px-2 py-2" /></label>
      <button onClick={submit} disabled={busy} className="w-fit rounded-doc bg-ink px-3 py-2 text-xs font-medium text-paper">{busy ? "Checking…" : "Confirm code"}</button>
    </div>}
    {message ? <p role="status" className="mt-2 text-xs text-graphite">{message}</p> : null}
  </div>;
}
