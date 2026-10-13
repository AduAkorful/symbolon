"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { postJson, postRecord } from "@/lib/client/api";
import { SentTransactionNotice, useSentTransaction } from "@/components/wallet/useSentTransaction";
import { moneyDraft, moneyInput } from "@/lib/money-draft";
import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError, InlineLoading } from "@/components/ui/States";
import { Callout } from "@/components/ui/Callout";
import { TxLink } from "@/components/TxLink";
import { checksum, duration, formatDateTime, showMoney } from "@/lib/format";
import { refreshAfterChain } from "@/lib/client/refresh";

type Option = { address: string; domain: number; source: string };
type Setup = { newPayeeDelay: string; defaultCap: string; defaultCapSource: "approval_threshold" | "budget" };
type ChoiceResult = { options: Option[]; defaults: { monthlyCap: string | null; requirePo: boolean; requireDelivery: boolean }; setup: Setup };

/** The cap is typed in dollars and sent in the Vault's own units; blank stays blank */
function capRaw(typed: string): string {
  const text = typed.trim().replace(/,/g, "");
  if (!text) return "";
  const draft = moneyDraft(text, 6);
  if (draft.error !== undefined) throw new Error(draft.error);
  return draft.raw.toString();
}

/** What an empty cap field turns into, in the Vault's own terms (plan 05zj C, SYM-36) */
function capHint(setup: Setup | null): string {
  if (!setup) return "Leave it empty to use the default cap.";
  const amount = showMoney(moneyInput(setup.defaultCap, 6), "USDC");
  return setup.defaultCapSource === "budget"
    ? `Left empty, this vendor's cap is ${amount}, the operating budget's own cap.`
    : `Left empty, this vendor's cap is ${amount}, your approval threshold.`;
}

/**
 * The Vault's wait on a new payee, said before anyone signs (plan 05zj C, SYM-10). It is a Vault rule so that a stolen session
 * can't add a payee and pay it in the same minute; shortening it is a delayed change, so it can't be skipped from here.
 */
function WaitNotice({ delaySeconds, asOf }: { delaySeconds: bigint; asOf: number }) {
  if (delaySeconds === 0n) {
    return <Callout tone="neutral">This Vault has no waiting period for new payees. This vendor can be paid as soon as the transaction is confirmed.</Callout>;
  }
  // fixed when the dialog was read, so the time doesn't creep while it is open; the confirmed time below is the Vault's own
  const from = new Date(asOf + Number(delaySeconds) * 1000);
  return (
    <Callout tone="info" title={`A new payee waits ${duration(delaySeconds)} before it can be paid`}>
      If you sign now, this vendor can be paid from about {formatDateTime(from)}. Their invoices wait until then. The waiting period is part
      of this Vault&apos;s policy; shortening it is itself a change that waits.
    </Callout>
  );
}

export function AddPayee({ businessId, seal, signer, explorer }: { businessId: string; seal: string; signer: SignerPlan; explorer: string }) {
  const discover = useWalletProviders();
  const [options, setOptions] = useState<Option[]>([]);
  const [selected, setSelected] = useState("");
  const [requirePo, setRequirePo] = useState(false);
  const [requireDelivery, setRequireDelivery] = useState(false);
  const [cap, setCap] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const tx = useSentTransaction();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // while a transaction is being sent or its receipt recorded the dialog stays; reading the payout choices can be abandoned
  const [sending, setSending] = useState(false);
  const [asOf, setAsOf] = useState(0);
  // the options read finished (with choices or with a reason there are none): the spinner shows only until then
  const [loaded, setLoaded] = useState(false);
  // what the Vault says once the transaction is confirmed: when this payee can first be paid
  const [added, setAdded] = useState<{ activeAt: string; txHash: string } | null>(null);
  const router = useRouter();
  const path = `/api/business/${businessId}/payee`;
  async function loadOptions() {
    setBusy(true); setError("");
    try { const result = await postJson<ChoiceResult>(path, { action: "options", seal }); setAsOf(Date.now()); setOptions(result.options); setSelected(result.options[0] ? `${result.options[0].address}:${result.options[0].domain}` : ""); setSetup(result.setup); setCap(result.defaults.monthlyCap ? moneyInput(result.defaults.monthlyCap, 6) : ""); setRequirePo(result.defaults.requirePo); setRequireDelivery(result.defaults.requireDelivery); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load payout choices."); }
    finally { setBusy(false); setLoaded(true); }
  }
  async function add() {
    const [payout, domainText] = selected.split(":");
    setBusy(true); setSending(true); setError("");
    try {
      const call = await postJson<{ to: string; data: string }>(path, { action: "prepare", seal, payout, domain: Number(domainText), requirePo, requireDelivery, monthlyCap: capRaw(cap) });
      await tx.run({
        send: () => sendCall(signer, call, discover),
        record: (hash) => postRecord<{ activeAt: string; txHash: string }>(path, { action: "record", txHash: hash, seal }),
        // stay open and say it is done: the dialog used to close the moment it was submitted, so nothing showed it had worked
        // the page is refreshed only on Done: once this payee exists the page stops drawing this component, which would close the dialog
        onDone: (r) => { setAdded({ activeAt: r.activeAt, txHash: r.txHash }); },
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't add this payee."); }
    finally { setBusy(false); setSending(false); }
  }
  const [open, setOpen] = useState(false);
  const openDialog = () => { setOpen(true); if (!options.length) void loadOptions(); };
  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={openDialog}>Set up as a payee</Button>
      {open ? (
        <Overlay title="Add this vendor as a payee" description="You sign one transaction that lets your Vault pay this vendor, within the terms below." onClose={() => { if (!sending && !tx.busy) { setOpen(false); if (tx.phase === "done") { tx.reset(); setAdded(null); refreshAfterChain(router); } } }}>
          {error ? (
            <InlineError>
              {error}
            </InlineError>
          ) : null}
          {!options.length && !loaded ? (
            <InlineLoading>Reading the vendor’s signed payout addresses…</InlineLoading>
          ) : !options.length ? (
            <div className="space-y-4">
              <p className="text-graphite">
                This vendor hasn’t given a payout address yet, so there is nothing to pay. Ask them to set where they’re paid in their Symbolon settings, or to
                sign an invoice to you. Then open this again.
              </p>
              <Overlay.Footer>
                <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
                <Button onClick={() => { setLoaded(false); void loadOptions(); }}>Check again</Button>
              </Overlay.Footer>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Payout address signed by this vendor">
                {(a) => (
                  <select {...a} value={selected} onChange={(e) => setSelected(e.target.value)} className={`${controlClass} min-w-0`}>
                    {options.map((o) => <option key={`${o.address}:${o.domain}`} value={`${o.address}:${o.domain}`}>{checksum(o.address)} · domain {o.domain} · {o.source}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Monthly cap, in dollars" hint={capHint(setup)}>
                {(a) => <input {...a} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder={setup ? moneyInput(setup.defaultCap, 6) : "5000.00"} className={controlClass} />}
              </Field>
              <div className="space-y-1">
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requirePo} onChange={(e) => setRequirePo(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require a purchase order</label>
                <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={requireDelivery} onChange={(e) => setRequireDelivery(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />Require delivery confirmation</label>
              </div>
              {setup && !added ? <WaitNotice delaySeconds={BigInt(setup.newPayeeDelay)} asOf={asOf} /> : null}
              {added ? (
                <Callout tone="ok" title="Payee added">
                  {BigInt(added.activeAt) === 0n || Number(added.activeAt) * 1000 <= Date.now()
                    ? "This vendor can be paid now."
                    : `This vendor can be paid from ${formatDateTime(new Date(Number(added.activeAt) * 1000))}. Their invoices wait until then.`}{" "}
                  <TxLink href={`${explorer}/tx/${added.txHash}`} label="View the transaction on the Arc explorer">{added.txHash.slice(0, 10)}…{added.txHash.slice(-8)}</TxLink>
                </Callout>
              ) : null}
              <SentTransactionNotice tx={tx} explorer={explorer} />
              <Overlay.Footer>
                {added ? (
                  <Button onClick={() => { setOpen(false); setAdded(null); tx.reset(); refreshAfterChain(router); }}>Done</Button>
                ) : (
                  <>
                    {tx.locked ? null : <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>}
                    <Button busy={busy || tx.busy} disabled={signer.kind === "none" || !selected || tx.locked} onClick={add}>{busy || tx.busy ? "Waiting…" : "Sign the transaction"}</Button>
                  </>
                )}
              </Overlay.Footer>
            </div>
          )}
        </Overlay>
      ) : null}
    </div>
  );
}
