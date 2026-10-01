"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Address } from "viem";

import { TxLink } from "@/components/TxLink";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { ComplianceViewModel, CounterpartyScreeningRow } from "@/lib/server/compliance";

export function ComplianceView({
  model,
  signer,
  explorer,
}: {
  model: ComplianceViewModel;
  signer: SignerPlan;
  explorer: string;
}) {
  const router = useRouter();
  const discover = useWalletProviders();

  const [busySeal, setBusySeal] = useState<string | null>(null);
  const [recordBusyId, setRecordBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { businessId, counterparties, tiers, canScreen, canWrite, vault } = model;
  const apiPath = `/api/business/${businessId}/compliance`;

  async function handleScreen(seal: Address) {
    setBusySeal(seal);
    setError(null);
    setNotice(null);
    try {
      const res = await postJson<{ ok: boolean; screening: { id: string; risk: number; result: string } }>(
        apiPath,
        { action: "screen", seal },
      );
      setNotice(`Screened: risk level is ${res.screening.risk === 0 ? "Low" : res.screening.risk === 1 ? "Medium" : res.screening.risk === 2 ? "High" : "Blocked"}. You can now record it to the Vault.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screening request failed.");
    } finally {
      setBusySeal(null);
    }
  }

  async function handleRecordWrite(screeningId: string) {
    setRecordBusyId(screeningId);
    setError(null);
    setNotice(null);
    try {
      const prep = await postJson<{ to: string; data: string }>(apiPath, {
        action: "prepare-write",
        screeningId,
      });

      const txHash = await sendCall(signer, prep, discover);
      await postJson(apiPath, {
        action: "record-write",
        screeningId,
        txHash,
      });

      setNotice(`Recorded on Vault: ${txHash.slice(0, 10)}…`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recording to Vault failed.");
    } finally {
      setRecordBusyId(null);
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="max-w-[1200px] space-y-10">
      <header className="space-y-2">
        <h1 className="font-display text-4xl">Compliance</h1>
        <p className="max-w-[70ch] text-sm text-graphite">
          Every counterparty payout address is screened against Circle’s Compliance Engine and recorded on the Vault.
          A failed check is never treated as clean.
        </p>
      </header>

      {error ? (
        <div role="alert" className="rounded border border-red/40 bg-red-wash/40 p-4 text-xs text-red">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div role="status" className="rounded border border-rule bg-paper-raised p-4 text-xs text-ink">
          {notice}
        </div>
      ) : null}

      {!vault ? (
        <div className="rounded border border-rule p-8 text-center">
          <p className="text-sm text-graphite">This business has no Vault set up yet.</p>
          <Link href="/business" className="mt-3 inline-block rounded bg-ink px-4 py-2 text-xs font-medium text-paper">
            Go to setup
          </Link>
        </div>
      ) : (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="counterparties-heading" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="counterparties-heading" className="font-display text-2xl">
                Counterparties
              </h2>
              <span className="font-mono text-xs text-graphite">
                {counterparties.length} counterpart{counterparties.length === 1 ? "y" : "ies"}
              </span>
            </div>

            {counterparties.length === 0 ? (
              <div className="rounded border border-rule p-8 text-center text-sm text-graphite">
                No payees registered on this Vault yet.{" "}
                <Link href="/business/vendors" className="underline underline-offset-4">
                  Add a vendor as a payee first.
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto rounded border border-rule bg-paper-raised">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="border-b border-rule bg-paper text-[11px] uppercase tracking-wider text-graphite">
                    <tr>
                      <th className="py-3 pl-4 pr-3 font-medium">Counterparty</th>
                      <th className="py-3 px-3 font-medium">Payout address</th>
                      <th className="py-3 px-3 font-medium">Risk</th>
                      <th className="py-3 px-3 font-medium">Status</th>
                      <th className="py-3 px-3 font-medium">Screened</th>
                      <th className="py-3 pl-3 pr-4 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule-soft">
                    {counterparties.map((row) => {
                      const isScreening = busySeal === row.seal;
                      const isRecording = recordBusyId === row.latestScreeningId;
                      const isHighOrBlocked = row.onchainRisk !== null && row.onchainRisk >= 2;

                      return (
                        <tr key={row.seal} className="hover:bg-paper/40">
                          <td className="py-3 pl-4 pr-3">
                            <div className="font-medium text-ink">{row.name}</div>
                            <div className="font-mono text-[10px] text-graphite">
                              <TxLink href={`${explorer}/address/${row.seal}`} label="Vendor Seal">
                                {row.seal.slice(0, 8)}…{row.seal.slice(-6)}
                              </TxLink>
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span>
                                {row.payoutAddress?.slice(0, 6) ?? "Unavailable"}…{row.payoutAddress?.slice(-4) ?? ""}
                              </span>
                              <button
                                type="button"
                                disabled={!row.payoutAddress}
                                onClick={() => row.payoutAddress && copyText(row.payoutAddress, row.seal)}
                                title="Copy full payout address"
                                className="text-[10px] text-graphite hover:text-ink"
                              >
                                {copied === row.seal ? "Copied" : "Copy"}
                              </button>
                            </div>
                            {row.hasAddressMismatch ? (
                              <span className="mt-1 inline-block rounded bg-red-wash px-1.5 py-0.5 text-[9px] font-medium text-red">
                                Payout changed since last screening
                              </span>
                            ) : null}
                          </td>

                          <td className="py-3 px-3">
                            <span
                              className={`rounded px-1.5 py-0.5 font-medium ${
                                isHighOrBlocked
                                  ? "bg-red-wash text-red"
                                  : row.onchainRisk === 1
                                    ? "bg-paper text-ink border border-rule"
                                    : "text-ink"
                              }`}
                            >
                              {row.riskLabel}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-graphite">
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                                row.status === "due"
                                  ? "text-red bg-red-wash"
                                  : row.status === "never"
                                    ? "text-graphite border border-rule-soft"
                                    : "text-ink"
                              }`}
                            >
                              {row.statusLabel}
                            </span>
                          </td>

                          <td className="py-3 px-3 text-graphite">
                            {row.screenedAt ? new Date(row.screenedAt).toLocaleDateString() : "Never"}
                          </td>

                          <td className="py-3 pl-3 pr-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {canScreen ? (
                                <button
                                  type="button"
                                  disabled={isScreening || isRecording}
                                  onClick={() => handleScreen(row.seal)}
                                  className="rounded border border-rule bg-paper px-2.5 py-1 text-[11px] font-medium text-ink hover:border-ink disabled:opacity-50"
                                >
                                  {isScreening ? "Screening…" : "Screen"}
                                </button>
                              ) : null}

                              {canWrite && row.latestScreeningId ? (
                                <button
                                  type="button"
                                  disabled={isScreening || isRecording || signer.kind === "none"}
                                  onClick={() => handleRecordWrite(row.latestScreeningId!)}
                                  title="Write latest screening result to Vault"
                                  className="rounded bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:opacity-90 disabled:opacity-50"
                                >
                                  {isRecording ? "Recording…" : "Save onchain"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="space-y-8">
            <section aria-labelledby="tiers-heading" className="space-y-3">
              <h2 id="tiers-heading" className="font-display text-xl">
                What each tier does
              </h2>
              <dl className="divide-y divide-rule-soft rounded border border-rule bg-paper-raised text-xs">
                {tiers.map((t) => (
                  <div key={t.tier} className="grid grid-cols-[6.5rem_1fr] p-3">
                    <dt className={`font-medium ${t.tier === "High" || t.tier === "Blocked" ? "text-red" : "text-ink"}`}>
                      {t.tier}
                    </dt>
                    <dd className="text-graphite">{t.action}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="reports-heading" className="space-y-3">
              <h2 id="reports-heading" className="font-display text-xl">
                Compliance report
              </h2>
              <p className="text-xs text-graphite">
                Export counterparty screening records with timestamps, rules, and decision hashes.
              </p>
              <div>
                <a
                  href={`/api/business/${businessId}/compliance?format=csv`}
                  download={`compliance-report-${businessId}.csv`}
                  className="inline-flex items-center gap-2 rounded border border-rule bg-paper px-3 py-2 text-xs font-medium text-ink hover:border-ink"
                >
                  Download CSV report
                </a>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
