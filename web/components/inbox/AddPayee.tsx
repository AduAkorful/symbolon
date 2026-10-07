"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { postJson } from "@/lib/client/api";
import { moneyDraft, moneyInput } from "@/lib/money-draft";

type Option = { address: string; domain: number; source: string };
type ChoiceResult = { options: Option[]; defaults: { monthlyCap: string | null; requirePo: boolean; requireDelivery: boolean } };

/** The cap is typed in dollars and sent in the Vault's own units; blank stays blank */
function capRaw(typed: string): string {
  const text = typed.trim().replace(/,/g, "");
  if (!text) return "";
  const draft = moneyDraft(text, 6);
  if (draft.error !== undefined) throw new Error(draft.error);
  return draft.raw.toString();
}

export function AddPayee({ businessId, seal, signer, explorer }: { businessId: string; seal: string; signer: SignerPlan; explorer: string }) {
  const discover = useWalletProviders();
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState("");
  const [requirePo, setRequirePo] = useState(false);
  const [requireDelivery, setRequireDelivery] = useState(false);
  const [cap, setCap] = useState("");
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const path = `/api/business/${businessId}/payee`;
  async function loadOptions() {
    setBusy(true); setError("");
    try { const result = await postJson<ChoiceResult>(path, { action: "options", seal }); setOptions(result.options); setSelected(result.options[0] ? `${result.options[0].address}:${result.options[0].domain}` : ""); setCap(result.defaults.monthlyCap ? moneyInput(result.defaults.monthlyCap, 6) : ""); setRequirePo(result.defaults.requirePo); setRequireDelivery(result.defaults.requireDelivery); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load payout choices."); }
    finally { setBusy(false); }
  }
  async function add() {
    const [payout, domainText] = selected.split(":");
    setBusy(true); setError("");
    try {
      const call = await postJson<{ to: string; data: string }>(path, { action: "prepare", seal, payout, domain: Number(domainText), requirePo, requireDelivery, monthlyCap: capRaw(cap) });
      const hash = await sendCall(signer, call, discover);
      setTxHash(hash);
      await confirm(hash);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't add this payee."); }
    finally { setBusy(false); }
  }
  async function confirm(hash = txHash) {
    if (!hash) return;
    setBusy(true); setError("");
    try { await postJson(path, { action: "record", txHash: hash, seal }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "The receipt isn't confirmed yet. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    {!options.length ? <button onClick={loadOptions} disabled={busy} className="rounded border border-rule px-3 py-1.5 text-xs disabled:opacity-60">{busy ? "Loading…" : "Set up payee"}</button> : <div className="grid max-w-[420px] gap-3 rounded border border-rule p-4 text-left">
      <label className="grid gap-1 text-xs">Payout address signed by this vendor<select value={selected} onChange={(e) => setSelected(e.target.value)} className="min-w-0 rounded border border-rule bg-paper px-2 py-2 font-mono text-[11px]">{options.map((o) => <option key={`${o.address}:${o.domain}`} value={`${o.address}:${o.domain}`}>{o.address} · domain {o.domain} · {o.source}</option>)}</select></label>
      <label className="grid gap-1 text-xs">Monthly cap in dollars (blank uses your current approval threshold)<input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="For example 5000.00" className="rounded border border-rule bg-paper px-2 py-2" /></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={requirePo} onChange={(e) => setRequirePo(e.target.checked)} />Require a purchase order</label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={requireDelivery} onChange={(e) => setRequireDelivery(e.target.checked)} />Require delivery confirmation</label>
      <button onClick={add} disabled={busy || signer.kind === "none" || !selected} className="w-fit rounded-doc bg-ink px-3 py-2 text-xs font-medium text-paper disabled:opacity-60">{busy ? "Waiting…" : "Sign add-payee transaction"}</button>
      {txHash ? <button onClick={() => confirm()} disabled={busy} className="w-fit text-xs underline">Check receipt: {txHash.slice(0, 10)}…</button> : null}
    </div>}
    {error ? <p role="alert" className="mt-2 max-w-[420px] text-xs text-red">{error}{txHash ? <> <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline">View transaction</a></> : null}</p> : null}
  </div>;
}
