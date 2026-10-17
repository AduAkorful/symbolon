"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";

import { TxLink } from "@/components/TxLink";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";
import { useSentHashes } from "@/components/wallet/useSentTransaction";
import type { ComplianceViewModel, CounterpartyScreeningRow } from "@/lib/server/compliance";
import { formatDay } from "@/lib/format";
import { Address as AddressView } from "@/components/Address";
import { Button, buttonClass, LinkButton } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { DetailList } from "@/components/ui/DetailList";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";
import { refreshAfterChain } from "@/lib/client/refresh";

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
  const [noticeTx, setNoticeTx] = useState<string | null>(null);
  const sent = useSentHashes();

  const { businessId, counterparties, tiers, canScreen, canWrite, vault } = model;
  const apiPath = `/api/business/${businessId}/compliance`;

  async function handleScreen(seal: Address) {
    setBusySeal(seal);
    setError(null);
    setNotice(null);
    setNoticeTx(null);
    try {
      const res = await postJson<{ ok: boolean; screening: { id: string; risk: number; result: string } }>(
        apiPath,
        { action: "screen", seal },
      );
      setNotice(`Screened: risk level is ${res.screening.risk === 0 ? "Low" : res.screening.risk === 1 ? "Medium" : res.screening.risk === 2 ? "High" : "Blocked"}. You can now record it to the Vault.`);
      refreshAfterChain(router);
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
    setNoticeTx(null);
    try {
      // a hash kept from an earlier try means the transaction was already sent: check it again, never send it twice
      let txHash = sent.get(screeningId);
      if (!txHash) {
        const prep = await postJson<{ to: string; data: string }>(apiPath, {
          action: "prepare-write",
          screeningId,
        });
        txHash = await sendCall(signer, prep, discover);
        sent.set(screeningId, txHash);
      }
      await postRecord(apiPath, {
        action: "record-write",
        screeningId,
        txHash,
      });
      sent.clear(screeningId);

      setNotice("Saved in the Vault.");
      setNoticeTx(txHash);
      refreshAfterChain(router);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recording to Vault failed.");
    } finally {
      setRecordBusyId(null);
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <PageTitle>Compliance</PageTitle>
        <Lead className="mt-3">
          A payee’s payout address is screened here with Circle’s Compliance Engine, and the result is recorded in the Vault. A vendor you haven’t added as a payee yet can’t be screened. A check that fails is never treated as clean.
        </Lead>
      </header>

      {error ? <Callout tone="danger">{error}</Callout> : null}
      {notice ? (
        <Callout tone="info" onDismiss={() => { setNotice(null); setNoticeTx(null); }}>
          {notice}
          {noticeTx ? <>{" "}<TxLink href={`${explorer}/tx/${noticeTx}`} label="View the transaction on the Arc explorer">View transaction</TxLink></> : null}
        </Callout>
      ) : null}

      {!vault ? (
        <EmptyState title="This business has no Vault yet" action={<LinkButton href="/business" size="sm">Go to setup</LinkButton>}>
          Screening results are recorded in the Vault, so create it first.
        </EmptyState>
      ) : (
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <section aria-labelledby="counterparties-heading" className="min-w-0 space-y-4">
            <div className="flex items-baseline justify-between gap-4">
              <SectionTitle id="counterparties-heading">Counterparties</SectionTitle>
              <span className="text-sm text-graphite">{counterparties.length} {counterparties.length === 1 ? "counterparty" : "counterparties"}</span>
            </div>

            {counterparties.length === 0 ? (
              <EmptyState title="No payees in this Vault yet" action={<LinkButton href="/business/vendors" variant="secondary" size="sm">Open vendors</LinkButton>}>
                Add a vendor as a payee first; then it can be screened here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-rule-soft border-y border-rule">
                {counterparties.map((row) => {
                  const isScreening = busySeal === row.seal;
                  const isRecording = recordBusyId !== null && recordBusyId === row.latestScreeningId;
                  const isHighOrBlocked = row.onchainRisk !== null && row.onchainRisk >= 2;
                  return (
                    <li key={row.seal} className="grid gap-x-6 gap-y-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{row.name}</p>
                        <p className="mt-1 text-sm text-graphite">
                          Seal <TxLink href={`${explorer}/address/${row.seal}`} label="View the vendor's Seal on the Arc explorer">{row.seal.slice(0, 8)}…{row.seal.slice(-6)}</TxLink>
                        </p>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                          <span className="text-graphite">Payout</span>
                          {row.payoutAddress ? <AddressView value={row.payoutAddress} full copy /> : <span className="text-graphite">{row.status === "unavailable" ? "Can’t confirm" : "Not set yet"}</span>}
                        </div>
                        {row.hasAddressMismatch ? <p className="mt-2"><StatusPill tone="danger">Payout changed since it was screened</StatusPill></p> : null}
                      </div>

                      <div className="min-w-0 md:text-right">
                        <p className="flex flex-wrap items-center gap-2 md:justify-end">
                          <StatusPill tone={isHighOrBlocked ? "danger" : row.onchainRisk === 1 ? "warn" : row.onchainRisk === 0 ? "ok" : "neutral"}>{row.riskLabel}</StatusPill>
                          <StatusPill tone={row.status === "due" ? "danger" : "neutral"}>{row.statusLabel}</StatusPill>
                        </p>
                        <p className="mt-2 text-sm text-graphite">
                          Screened {row.screenedAt ? formatDay(new Date(row.screenedAt)) : "never"}
                          {/* the owner sees the link beside "Saved in the Vault"; everyone else sees it here (QA SYM-03) */}
                          {row.savedTx && !(canWrite && row.latestScreeningId && row.latestWritten) ? <>{" · "}<TxLink href={`${explorer}/tx/${row.savedTx}`} label="View the screening's transaction on the Arc explorer">View transaction</TxLink></> : null}
                        </p>
                        {row.status === "not_payee" ? <p className="mt-1 text-sm text-graphite">Add this vendor as a payee first, then screen it here.</p> : null}
                        {canScreen || (canWrite && row.latestScreeningId) ? (
                          <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                            {canScreen ? (
                              <Button variant="secondary" size="sm" disabled={isScreening || isRecording || row.status === "not_payee"} busy={isScreening} title={row.status === "not_payee" ? "Add this vendor as a payee first" : undefined} onClick={() => handleScreen(row.seal)}>
                                {isScreening ? "Screening…" : "Screen"}
                              </Button>
                            ) : null}
                            {canWrite && row.latestScreeningId && row.latestWritten ? (
                              <span className="self-center text-sm text-graphite">
                                Saved in the Vault
                                {row.savedTx ? <>{" · "}<TxLink href={`${explorer}/tx/${row.savedTx}`} label="View the screening's transaction on the Arc explorer">View transaction</TxLink></> : null}
                              </span>
                            ) : null}
                            {canWrite && row.latestScreeningId && !row.latestWritten ? (
                              <Button size="sm" disabled={isScreening || isRecording || signer.kind === "none"} busy={isRecording} title="Write the latest screening result to the Vault" onClick={() => handleRecordWrite(row.latestScreeningId!)}>
                                {isRecording ? "Recording…" : row.latestScreeningId && sent.get(row.latestScreeningId) ? "Check again" : "Save in the Vault"}
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="min-w-0 space-y-8">
            <section aria-labelledby="tiers-heading" className="space-y-3">
              <SectionTitle id="tiers-heading">What each tier does</SectionTitle>
              <DetailList items={tiers.map((t) => ({ label: <span className={t.tier === "High" || t.tier === "Blocked" ? "text-red" : "text-ink"}>{t.tier}</span>, value: <span className="font-normal text-graphite">{t.action}</span> }))} />
            </section>

            <section aria-labelledby="reports-heading" className="space-y-3">
              <SectionTitle id="reports-heading">Compliance report</SectionTitle>
              <p className="text-sm text-graphite">Counterparty screening records with their times, rules and decision hashes.</p>
              <a href={`/api/business/${businessId}/compliance?format=csv`} download={`compliance-report-${businessId}.csv`} className={buttonClass({ variant: "secondary" })}>
                Download the CSV report
              </a>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
