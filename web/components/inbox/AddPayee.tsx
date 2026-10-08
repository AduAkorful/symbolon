"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { postJson } from "@/lib/client/api";
import { moneyDraft, moneyInput } from "@/lib/money-draft";
import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError, InlineLoading } from "@/components/ui/States";
import { checksum } from "@/lib/format";
import { refreshAfterChain } from "@/lib/client/refresh";

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
  // while a transaction is being sent or its receipt recorded the dialog stays; reading the payout choices can be abandoned
  const [sending, setSending] = useState(false);
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
    setBusy(true); setSending(true); setError("");
    try {
      const call = await postJson<{ to: string; data: string }>(path, { action: "prepare", seal, payout, domain: Number(domainText), requirePo, requireDelivery, monthlyCap: capRaw(cap) });
      const hash = await sendCall(signer, call, discover);
      setTxHash(hash);
      await confirm(hash);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't add this payee."); }
    finally { setBusy(false); setSending(false); }
  }
  async function confirm(hash = txHash) {
    if (!hash) return;
    setBusy(true); setError("");
    try { await postJson(path, { action: "record", txHash: hash, seal }); refreshAfterChain(router); }
    catch (e) { setError(e instanceof Error ? e.message : "The receipt isn't confirmed yet. Try again."); }
    finally { setBusy(false); }
  }
  const [open, setOpen] = useState(false);
  const openDialog = () => { setOpen(true); if (!options.length) void loadOptions(); };
  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={openDialog}>Set up as a payee</Button>
      {open ? (
        <Overlay title="Add this vendor as a payee" description="You sign one transaction that lets your Vault pay this vendor, within the terms below." onClose={() => { if (!sending) setOpen(false); }}>
          {error ? (
            <InlineError>
              {error}
              {txHash ? <> <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="underline">View the transaction</a></> : null}
            </InlineError>
          ) : null}
          {!options.length ? (
            <InlineLoading>Reading the vendor’s signed payout addresses…</InlineLoading>
          ) : (
            <div className="space-y-4">
              <Field label="Payout address signed by this vendor">
                {(a) => (
                  <select {...a} value={selected} onChange={(e) => setSelected(e.target.value)} className={`${controlClass} min-w-0`}>
                    {options.map((o) => <option key={`${o.address}:${o.domain}`} value={`${o.address}:${o.domain}`}>{checksum(o.address)} · domain {o.domain} · {o.source}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Monthly cap, in dollars" hint="Leave it empty to use your current approval threshold.">
                {(a) => <input {...a} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="5000.00" className={controlClass} />}
              </Field>
              <div className="space-y-1">
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requirePo} onChange={(e) => setRequirePo(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require a purchase order</label>
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requireDelivery} onChange={(e) => setRequireDelivery(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require delivery confirmation</label>
              </div>
              <Overlay.Footer>
                {txHash ? <Button variant="secondary" disabled={busy} onClick={() => confirm()}>Check the receipt</Button> : <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>}
                <Button busy={busy} disabled={signer.kind === "none" || !selected} onClick={add}>{busy ? "Waiting…" : "Sign the transaction"}</Button>
              </Overlay.Footer>
            </div>
          )}
        </Overlay>
      ) : null}
    </div>
  );
}
