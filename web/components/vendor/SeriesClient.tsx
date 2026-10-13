"use client";

import { useRef, useState } from "react";

import { Overlay } from "@/components/Overlay";
import { Callout } from "@/components/ui/Callout";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/useConfirm";
import { controlClass, Field } from "@/components/ui/Field";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import type { PreparedPeriod, SeriesDisplay } from "@/lib/server/series";
import { formatDay } from "@/lib/format";
import { EmptyState, InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Eyebrow, Lead, PageTitle, SmallTitle } from "@/components/ui/Type";

export interface ClientOption {
  id: string;
  name: string;
  vault: string | null;
  email: string | null;
}

interface Props {
  initialSeries: SeriesDisplay[];
  /** The next number in the vendor's own sequence, the base the series' invoices are numbered from */
  nextNumber?: string;
  clients: ClientOption[];
  signer: SignerPlan;
}

export function SeriesClient({ initialSeries, clients, signer, nextNumber = "" }: Props) {
  const discover = useWalletProviders();
  const [ask, confirmDialog] = useConfirm();
  const [seriesList, setSeriesList] = useState<SeriesDisplay[]>(initialSeries);
  const [openCreate, setOpenCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [selectedClient, setSelectedClient] = useState(clients[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<"USDC" | "EURC">("USDC");
  // Nothing is made up for the vendor to sign (plan 05zj F, SYM-35): the fields start empty with a hint of what goes there, the
  // invoice numbers continue the vendor's own sequence, and a series can have several lines like any invoice.
  const [periods, setPeriods] = useState("");
  const [intervalType, setIntervalType] = useState<"monthly" | "days">("monthly");
  const [intervalDays, setIntervalDays] = useState("");
  const [dueAfterDays, setDueAfterDays] = useState("");
  const [numberBase, setNumberBase] = useState(nextNumber);
  const [seriesLines, setSeriesLines] = useState<{ id: number; description: string; quantity: string; unitPrice: string }[]>([{ id: 1, description: "", quantity: "1", unitPrice: "" }]);
  const nextLineId = useRef(2);

  // Signing flow state
  const [prepared, setPrepared] = useState<PreparedPeriod[] | null>(null);
  const [signingProgress, setSigningProgress] = useState<{ current: number; total: number } | null>(null);

  async function reloadSeries() {
    try {
      const res = await fetch("/api/vendor/series");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setSeriesList(data.series);
    } catch {
      setError("Couldn't refresh your series. What's shown may be out of date; reload the page.");
    }
  }

  async function handleCancel(seriesId: string) {
    if (!(await ask({ title: "End this series?", body: "The invoices not yet released will never be issued. Ones already released are not affected.", confirmLabel: "End the series", destructive: true }))) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", seriesId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel series");
      await reloadSeries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** What is wrong with the form, in one sentence, or null; the server checks again */
  function seriesProblem(): string | null {
    const whole = (t: string) => /^\d+$/.test(t.trim());
    if (!numberBase.trim()) return "Give the invoices a number to start from.";
    if (!whole(periods) || Number(periods) < 1 || Number(periods) > 60) return "The number of invoices is a whole number from 1 to 60.";
    if (!whole(dueAfterDays) || Number(dueAfterDays) > 365) return "Due after is a whole number of days, 0 to 365.";
    if (intervalType === "days" && (!whole(intervalDays) || Number(intervalDays) < 1 || Number(intervalDays) > 365)) return "Every is a whole number of days, 1 to 365.";
    for (const [i, l] of seriesLines.entries()) {
      if (!l.description.trim()) return `Line ${i + 1} needs a description.`;
      if (!/^\d+(\.\d{1,6})?$/.test(l.quantity.trim()) || Number(l.quantity) <= 0) return `Line ${i + 1}: the quantity is a number more than zero.`;
      if (!/^\d+(\.\d{1,6})?$/.test(l.unitPrice.trim())) return `Line ${i + 1}: the amount is a number of zero or more, like 2000 or 2000.50 (no minus sign).`;
    }
    return null;
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const client = clients.find((c) => c.id === selectedClient);
    if (!client) {
      setError("Please select a client.");
      setBusy(false);
      return;
    }

    const problem = seriesProblem();
    if (problem) {
      setError(problem);
      setBusy(false);
      return;
    }

    const templateDraft = {
      client: {
        name: client.name,
        ...(client.vault ? { vault: client.vault } : {}),
        ...(client.email ? { email: client.email } : {}),
      },
      currency,
      invoiceNumber: numberBase.trim(),
      dueDays: Number(dueAfterDays),
      lines: seriesLines.map((l) => ({ description: l.description.trim(), quantity: l.quantity.trim(), unitPrice: l.unitPrice.trim() })),
      notes: description.trim() || undefined,
    };

    const startEpoch = Math.floor(Date.now() / 1000);
    const schedule = {
      start: startEpoch,
      periods: Number(periods),
      every: intervalType === "monthly" ? "monthly" : { days: Number(intervalDays) },
      dueAfterDays: Number(dueAfterDays),
    };

    try {
      const res = await fetch("/api/vendor/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          template: templateDraft,
          schedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to prepare series");
      setPrepared(data.periods);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignAll() {
    if (!prepared || prepared.length === 0) return;
    setError(null);
    setBusy(true);

    const signatures: string[] = [];
    try {
      for (let i = 0; i < prepared.length; i++) {
        setSigningProgress({ current: i + 1, total: prepared.length });
        const p = prepared[i]!;
        const sig = await signTypedData(signer, p.typedData, discover);
        signatures.push(sig);
      }

      setSigningProgress(null);

      // Submit all signed envelopes
      const res = await fetch("/api/vendor/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          periods: prepared,
          signatures,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit series");

      setPrepared(null);
      setOpenCreate(false);
      await reloadSeries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setSigningProgress(null);
    }
  }

  return (
    <div className="pb-24">
      {confirmDialog}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Recurring invoices</PageTitle>
          <Lead className="mt-3">
            Retainers and other recurring invoices are sealed once, up front. Symbolon releases each one on its date and never holds your keys or signs for you.
          </Lead>
        </div>
        <Button onClick={() => { setPrepared(null); setError(null); setOpenCreate(true); }}>New series</Button>
      </div>

      {error ? <InlineError className="mt-6">{error}</InlineError> : null}

      <section aria-label="Your recurring series" className="mt-10">
        {seriesList.length === 0 ? (
          <EmptyState title="No recurring series yet" action={<Button onClick={() => { setPrepared(null); setError(null); setOpenCreate(true); }}>New series</Button>}>
            Set one up for a retainer or any invoice you send on a schedule.
          </EmptyState>
        ) : (
          <ul className="grid gap-5 md:grid-cols-2">
            {seriesList.map((s) => (
              <li key={s.id} className="flex flex-col justify-between rounded-doc border border-rule bg-paper-raised px-6 py-5">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <Eyebrow as="span">{s.totalPeriods} invoices</Eyebrow>
                    <StatusPill tone={s.status === "active" ? "ok" : "neutral"} className="capitalize">{s.status}</StatusPill>
                  </div>
                  <SmallTitle as="h2" className="mt-2 text-xl">{s.description || "Recurring series"}</SmallTitle>
                  <p className="mt-2 text-sm text-graphite">
                    Created {formatDay(new Date(s.createdAt))} · {s.releasedPeriods} of {s.totalPeriods} released
                  </p>
                  {s.status === "active" && s.nextReleaseAt ? (
                    <p className="mt-1 text-sm font-medium text-seal">Next release: {formatDay(new Date(s.nextReleaseAt))}</p>
                  ) : null}
                  {s.status === "active" && s.wrongDomainPeriods > 0 ? (
                    <Callout tone="warn" title="These invoices can't be paid" className="mt-3">
                      {s.wrongDomainPeriods === 1 ? "One invoice in this series was" : `${s.wrongDomainPeriods} invoices in this series were`} signed for
                      a payout on another chain, so no business can pay {s.wrongDomainPeriods === 1 ? "it" : "them"}. A signature can&apos;t be
                      changed: end this series and make it again.
                    </Callout>
                  ) : null}
                </div>

                {s.status === "active" ? (
                  <div className="mt-5 flex justify-end border-t border-rule-soft pt-4">
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => handleCancel(s.id)}>End the series</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create / preview dialog */}
      {openCreate ? (
        <Overlay
          title={prepared ? "Review and sign the series" : "New recurring series"}
          description={prepared ? undefined : "Every invoice in the series is signed now; Symbolon only releases each one on its date."}
          size={prepared ? "lg" : "md"}
          onClose={() => {
            if (!busy) {
              setOpenCreate(false);
              setPrepared(null);
            }
          }}
        >
          {!prepared ? (
            <form onSubmit={handlePreview} className="space-y-4">
              <Field label="Client">
                {(a) => (
                  <select {...a} value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} className={controlClass}>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.vault ? `(${c.vault.slice(0, 6)}…)` : c.email ? `(${c.email})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field label="Series name">
                {(a) => <input {...a} type="text" required placeholder="Design retainer" value={description} onChange={(e) => setDescription(e.target.value)} className={controlClass} />}
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Number of invoices">
                  {(a) => <input {...a} type="text" inputMode="numeric" placeholder="6" value={periods} onChange={(e) => setPeriods(e.target.value)} className={controlClass} />}
                </Field>
                <Field label="Currency">
                  {(a) => (
                    <select {...a} value={currency} onChange={(e) => setCurrency(e.target.value as any)} className={controlClass}>
                      <option value="USDC">USDC</option>
                      <option value="EURC">EURC</option>
                    </select>
                  )}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Released">
                  {(a) => (
                    <select {...a} value={intervalType} onChange={(e) => setIntervalType(e.target.value as any)} className={controlClass}>
                      <option value="monthly">Monthly</option>
                      <option value="days">Every few days</option>
                    </select>
                  )}
                </Field>
                {intervalType === "days" ? (
                  <Field label="Every (days)">
                    {(a) => <input {...a} type="text" inputMode="numeric" placeholder="14" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} className={controlClass} />}
                  </Field>
                ) : null}
                <Field label="Due after (days)">
                  {(a) => <input {...a} type="text" inputMode="numeric" placeholder="30" value={dueAfterDays} onChange={(e) => setDueAfterDays(e.target.value)} className={controlClass} />}
                </Field>
              </div>

              <Field label="Invoice numbers start from" hint={`Each invoice is numbered ${numberBase.trim() || "…"}-01, ${numberBase.trim() || "…"}-02, and so on.`}>
                {(a) => <input {...a} type="text" value={numberBase} onChange={(e) => setNumberBase(e.target.value)} maxLength={90} className={controlClass} />}
              </Field>

              <fieldset className="space-y-3 border-t border-rule pt-4">
                <legend className="mb-1 text-sm font-medium text-ink">Lines on each invoice</legend>
                {seriesLines.map((l, i) => (
                  <div key={l.id} className="grid gap-3 rounded-doc border border-rule p-3 sm:grid-cols-[1fr_5rem_7rem_auto]">
                    <input className={`${controlClass} sm:col-span-4`} type="text" value={l.description} placeholder={i === 0 ? "What you do each period, e.g. Design retainer" : "Another line"} aria-label={`Line ${i + 1} description`} onChange={(e) => setSeriesLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))} />
                    <label className="text-sm text-graphite sm:col-start-2 sm:row-start-2">
                      Qty
                      <input className={`${controlClass} mt-1 w-full`} inputMode="decimal" value={l.quantity} onChange={(e) => setSeriesLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, quantity: e.target.value } : x)))} />
                    </label>
                    <label className="text-sm text-graphite sm:col-start-3 sm:row-start-2">
                      Amount
                      <input className={`${controlClass} mt-1 w-full`} inputMode="decimal" placeholder="2000.00" value={l.unitPrice} onChange={(e) => setSeriesLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, unitPrice: e.target.value } : x)))} />
                    </label>
                    {seriesLines.length > 1 ? (
                      <button type="button" onClick={() => setSeriesLines((ls) => ls.filter((x) => x.id !== l.id))} className="min-h-9 self-end text-sm text-graphite underline decoration-rule underline-offset-4 sm:col-start-4 sm:row-start-2">
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                {seriesLines.length < 20 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setSeriesLines((ls) => [...ls, { id: nextLineId.current++, description: "", quantity: "1", unitPrice: "" }])}>
                    Add a line
                  </Button>
                ) : null}
              </fieldset>

              <Overlay.Footer>
                <Button variant="secondary" onClick={() => setOpenCreate(false)}>Cancel</Button>
                <Button type="submit" busy={busy}>{busy ? "Preparing…" : "Preview the invoices"}</Button>
              </Overlay.Footer>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-graphite">
                Review the {prepared.length} scheduled invoices. Signing asks your wallet for one signature per invoice.
              </p>

              <div className="max-h-72 overflow-auto rounded-doc border border-rule">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-rule bg-paper-raised">
                    <tr>
                      <th scope="col" className="p-2.5 font-medium text-graphite">No.</th>
                      <th scope="col" className="p-2.5 font-medium text-graphite">Invoice</th>
                      <th scope="col" className="p-2.5 font-medium text-graphite">Issued</th>
                      <th scope="col" className="p-2.5 font-medium text-graphite">Due</th>
                      <th scope="col" className="p-2.5 text-right font-medium text-graphite">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-soft">
                    {prepared.map((p) => (
                      <tr key={p.period}>
                        <td className="p-2.5">{p.period}</td>
                        <td className="whitespace-nowrap p-2.5">{p.invoiceNumber}</td>
                        <td className="whitespace-nowrap p-2.5">{formatDay(new Date(p.issuedAt * 1000))}</td>
                        <td className="whitespace-nowrap p-2.5">{formatDay(new Date(p.dueDate * 1000))}</td>
                        <td className="whitespace-nowrap p-2.5 text-right font-medium">{p.total} {currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {signingProgress ? (
                <div role="status" className="rounded-doc border border-seal/40 bg-seal-wash px-4 py-3 text-center">
                  <p className="font-medium text-seal">Signing invoice {signingProgress.current} of {signingProgress.total}…</p>
                  <p className="mt-1 text-graphite">Confirm in your wallet window.</p>
                </div>
              ) : null}

              <Overlay.Footer>
                <Button variant="secondary" disabled={busy} onClick={() => setPrepared(null)}>Back to edit</Button>
                <Button busy={busy} onClick={handleSignAll}>{busy ? "Signing…" : `Sign all ${prepared.length}`}</Button>
              </Overlay.Footer>
            </div>
          )}
        </Overlay>
      ) : null}
    </div>
  );
}
