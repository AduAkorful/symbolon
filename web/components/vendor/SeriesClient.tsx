"use client";

import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import type { PreparedPeriod, SeriesDisplay } from "@/lib/server/series";
import { formatDay } from "@/lib/format";

export interface ClientOption {
  id: string;
  name: string;
  vault: string | null;
  email: string | null;
}

interface Props {
  initialSeries: SeriesDisplay[];
  clients: ClientOption[];
  signer: SignerPlan;
}

export function SeriesClient({ initialSeries, clients, signer }: Props) {
  const discover = useWalletProviders();
  const [seriesList, setSeriesList] = useState<SeriesDisplay[]>(initialSeries);
  const [openCreate, setOpenCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [selectedClient, setSelectedClient] = useState(clients[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<"USDC" | "EURC">("USDC");
  const [periods, setPeriods] = useState<number>(6);
  const [intervalType, setIntervalType] = useState<"monthly" | "days">("monthly");
  const [intervalDays, setIntervalDays] = useState<number>(14);
  const [dueAfterDays, setDueAfterDays] = useState<number>(30);
  const [itemDesc, setItemDesc] = useState("Monthly Retainer");
  const [itemPrice, setItemPrice] = useState("2000.00");

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
    if (!confirm("Are you sure you want to end this series? Remaining unreleased periods will never be issued.")) return;
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

    const templateDraft = {
      client: {
        name: client.name,
        ...(client.vault ? { vault: client.vault } : {}),
        ...(client.email ? { email: client.email } : {}),
      },
      currency,
      invoiceNumber: description ? description.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "RET" : "RET",
      dueDays: dueAfterDays,
      lines: [
        {
          description: itemDesc.trim(),
          quantity: "1",
          unitPrice: itemPrice.trim(),
        },
      ],
      notes: description.trim() || undefined,
    };

    const startEpoch = Math.floor(Date.now() / 1000);
    const schedule = {
      start: startEpoch,
      periods,
      every: intervalType === "monthly" ? "monthly" : { days: intervalDays },
      dueAfterDays,
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
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="font-display text-4xl leading-tight">Recurring Series</h1>
          <p className="mt-1 text-sm text-graphite max-w-[65ch]">
            Retainers and recurring invoices are sealed once up front. Symbolon releases each period&apos;s invoice on its schedule.
            Symbolon never holds your keys or signs on your behalf.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPrepared(null);
            setError(null);
            setOpenCreate(true);
          }}
          className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:opacity-90 self-start md:self-auto"
        >
          + New Series
        </button>
      </div>

      {error ? (
        <div role="alert" className="mt-6 rounded-doc border border-red/40 bg-red-wash p-4 text-sm text-red">
          {error}
        </div>
      ) : null}

      {/* Series List */}
      <section aria-label="Recurring Series List" className="mt-10">
        {seriesList.length === 0 ? (
          <div className="rounded-doc border border-rule/70 p-8 text-center text-sm text-graphite">
            You haven&apos;t created any recurring series yet. Click &quot;+ New Series&quot; to set up a retainer.
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {seriesList.map((s) => (
              <div key={s.id} className="rounded-doc border border-rule bg-paper p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-wider text-graphite">
                      {s.totalPeriods} periods
                    </span>
                    <span
                      className={`font-mono text-xs uppercase tracking-wider px-2 py-0.5 rounded-sm ${
                        s.status === "active" ? "bg-seal/10 text-seal" : "bg-red-wash text-red"
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-medium">
                    {s.description || "Recurring Series"}
                  </h2>
                  <p className="mt-2 text-xs text-graphite">
                    Created {formatDay(new Date(s.createdAt))} · {s.releasedPeriods} of {s.totalPeriods} invoices released
                  </p>
                  {s.status === "active" && s.nextReleaseAt ? (
                    <p className="mt-1 text-xs text-seal font-medium">
                      Next release: {formatDay(new Date(s.nextReleaseAt))}
                    </p>
                  ) : null}
                </div>

                {s.status === "active" ? (
                  <div className="mt-6 pt-4 border-t border-rule flex justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleCancel(s.id)}
                      className="rounded-doc border border-red/50 px-3 py-1.5 text-xs text-red hover:bg-red-wash disabled:opacity-50"
                    >
                      End series
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create / Preview Modal */}
      {openCreate ? (
        <Overlay
          label={{ id: "create-series-title" }}
          onClose={() => {
            if (!busy) {
              setOpenCreate(false);
              setPrepared(null);
            }
          }}
        >
          <div className="p-7">
            <h2 id="create-series-title" className="font-display text-3xl">
              {prepared ? "Preview & Sign Series" : "New Recurring Series"}
            </h2>

            {!prepared ? (
              <form onSubmit={handlePreview} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="client-select" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                    Client
                  </label>
                  <select
                    id="client-select"
                    value={selectedClient}
                    onChange={(e) => setSelectedClient(e.target.value)}
                    className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.vault ? `(${c.vault.slice(0, 6)}…)` : c.email ? `(${c.email})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="desc-input" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                    Series Description / Title
                  </label>
                  <input
                    id="desc-input"
                    type="text"
                    required
                    placeholder="e.g. Design Retainer"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="periods-input" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                      Number of Periods
                    </label>
                    <input
                      id="periods-input"
                      type="number"
                      min={1}
                      max={60}
                      value={periods}
                      onChange={(e) => setPeriods(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="currency-select" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                      Currency
                    </label>
                    <select
                      id="currency-select"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value as any)}
                      className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                    >
                      <option value="USDC">USDC</option>
                      <option value="EURC">EURC</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="interval-select" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                      Release Frequency
                    </label>
                    <select
                      id="interval-select"
                      value={intervalType}
                      onChange={(e) => setIntervalType(e.target.value as any)}
                      className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="days">Custom Days</option>
                    </select>
                  </div>

                  {intervalType === "days" ? (
                    <div>
                      <label htmlFor="days-input" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                        Every N Days
                      </label>
                      <input
                        id="days-input"
                        type="number"
                        min={1}
                        max={365}
                        value={intervalDays}
                        onChange={(e) => setIntervalDays(Number(e.target.value))}
                        className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                      />
                    </div>
                  ) : null}

                  <div>
                    <label htmlFor="due-days-input" className="block text-xs font-medium uppercase tracking-wider text-graphite">
                      Due After (Days)
                    </label>
                    <input
                      id="due-days-input"
                      type="number"
                      min={1}
                      max={365}
                      value={dueAfterDays}
                      onChange={(e) => setDueAfterDays(Number(e.target.value))}
                      className="mt-1.5 w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="border-t border-rule pt-4">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-graphite">Line Item</h3>
                  <div className="mt-2 grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <input
                        type="text"
                        placeholder="Description"
                        value={itemDesc}
                        onChange={(e) => setItemDesc(e.target.value)}
                        className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Amount"
                        value={itemPrice}
                        onChange={(e) => setItemPrice(e.target.value)}
                        className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-rule">
                  <button
                    type="button"
                    onClick={() => setOpenCreate(false)}
                    className="rounded-doc border border-rule px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-doc bg-ink px-5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Preparing..." : "Preview Periods →"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-graphite">
                  Review the {prepared.length} scheduled invoices below. When you click &quot;Sign All Periods&quot;,
                  your wallet will prompt you to sign each period.
                </p>

                <div className="max-h-60 overflow-y-auto border border-rule rounded-doc">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-rule-soft/50 border-b border-rule">
                      <tr>
                        <th className="p-2.5">Period</th>
                        <th className="p-2.5">Invoice #</th>
                        <th className="p-2.5">Issue Date</th>
                        <th className="p-2.5">Due Date</th>
                        <th className="p-2.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule/60">
                      {prepared.map((p) => (
                        <tr key={p.period}>
                          <td className="p-2.5 font-medium">{p.period}</td>
                          <td className="p-2.5 font-mono">{p.invoiceNumber}</td>
                          <td className="p-2.5">{formatDay(new Date(p.issuedAt * 1000))}</td>
                          <td className="p-2.5">{formatDay(new Date(p.dueDate * 1000))}</td>
                          <td className="p-2.5 text-right font-medium">{p.total} {currency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {signingProgress ? (
                  <div className="rounded-doc border border-seal/50 bg-seal/5 p-4 text-center">
                    <p className="font-medium text-sm text-seal">
                      Signing period {signingProgress.current} of {signingProgress.total}...
                    </p>
                    <p className="text-xs text-graphite mt-1">Please confirm in your wallet window.</p>
                  </div>
                ) : null}

                <div className="mt-6 flex justify-between gap-3 pt-4 border-t border-rule">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPrepared(null)}
                    className="rounded-doc border border-rule px-4 py-2 text-sm"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSignAll}
                    className="rounded-doc bg-ink px-5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? "Signing..." : `Sign All ${prepared.length} Periods`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
