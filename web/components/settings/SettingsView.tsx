"use client";

import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { QueuedChangeList } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";
import { useSentHashes } from "@/components/wallet/useSentTransaction";
import type { SettingsViewData } from "@/lib/server/settings";
import type { ReleaseViewInfo, ReleaseNudgeResult } from "@/lib/server/release";
import { Rename } from "./Rename";
import { ReleaseCard } from "./ReleaseCard";
import { CurrencyRow } from "./CurrencyRow";
import { ReleaseNudge } from "./ReleaseNudge";
import { Address } from "@/components/Address";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle, SmallTitle } from "@/components/ui/Type";

interface SettingsViewProps {
  initialData: SettingsViewData & {
    release: ReleaseViewInfo | null;
    nudge: ReleaseNudgeResult | null;
  };
  signer: SignerPlan;
  isOwner: boolean;
  userRole?: string;
  explorer?: string;
}

export function SettingsView({
  initialData,
  signer,
  isOwner,
  userRole = "member",
  explorer = "https://explorer.testnet.arc.io",
}: SettingsViewProps) {
  const [data, setData] = useState(initialData);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoSuccess, setAutoSuccess] = useState<string | null>(null);
  const getProviders = useWalletProviders();
  const sent = useSentHashes();

  const { business, vaultDetails, release, nudge } = data;

  // bumped after every refresh so "Changes waiting" reads again: a change queued from this page appears in it at once
  const [queueVersion, setQueueVersion] = useState(0);

  async function handleRefresh() {
    setQueueVersion((v) => v + 1);
    try {
      const res = await fetch(`/api/business/${business.id}/settings`);
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setAutoError("Couldn't refresh these settings. What's shown may be out of date; reload the page.");
    }
  }

  async function handleToggleAutoUpdate(targetState: boolean) {
    setAutoBusy(true);
    setAutoError(null);
    setAutoSuccess(null);
    try {
      const key = `auto:${targetState}`;
      let txHash = sent.get(key);
      if (!txHash) {
        const prep = await postJson<{
          ok: boolean;
          to: string;
          data: string;
          state: string;
          eta?: string;
        }>(`/api/business/${business.id}/settings`, {
          action: "prepare-auto-update",
          enabled: targetState,
        });

        if (!prep.ok) throw new Error("Could not prepare auto-update change.");
        if (signer.kind !== "wallet") throw new Error("Wallet not connected.");

        const providers = await getProviders();
        txHash = await sendWithWallet(providers, signer, {
          to: prep.to,
          data: prep.data,
        });
        // kept from here: a failed record is checked again, never sent twice
        sent.set(key, txHash);
      }

      const rec = await postRecord<{ ok: boolean; status?: string }>(
        `/api/business/${business.id}/settings`,
        {
          action: "record-auto-update",
          txHash,
        },
      );
      sent.clear(key);

      if (rec.ok) {
        if (targetState) {
          setAutoSuccess("Auto-update change submitted. Because it is a loosening change, it is queued for the Vault's loosening delay.");
        } else {
          setAutoSuccess("Auto-update disabled immediately.");
        }
        await handleRefresh();
      }
    } catch (err: unknown) {
      setAutoError(err instanceof Error ? err.message : "Failed to change auto-update setting.");
    } finally {
      setAutoBusy(false);
    }
  }

  const zero = "0x0000000000000000000000000000000000000000";
  return (
    <div className="space-y-12">
      <div>
        <PageTitle>Settings</PageTitle>
        <Lead className="mt-3">Your business’s name, the Vault’s details, upgrades and the links to roles and rules.</Lead>
      </div>

      <ReleaseNudge nudge={nudge} state={release?.state as never} readyAt={release?.scheduled?.readyAt} />

      <section aria-labelledby="org-heading">
        <SectionTitle id="org-heading">Organization</SectionTitle>
        <dl className="mt-4 divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Business name</dt>
            <dd>
              <Rename
                businessId={business.id}
                initialName={business.name}
                isOwner={isOwner}
                onRenamed={(newName) => setData((prev) => ({ ...prev, business: { ...prev.business, name: newName } }))}
              />
            </dd>
          </div>
          <div className="grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Your role</dt>
            <dd className="capitalize text-ink">{userRole}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-3">
          <LinkButton href="/business/team" variant="secondary">Team and roles</LinkButton>
          <LinkButton href="/business/policy" variant="secondary">Policy and rules</LinkButton>
          <LinkButton href="/business/treasury" variant="secondary">Treasury and Early Pay</LinkButton>
        </div>
      </section>

      {vaultDetails ? (
        <section aria-labelledby="vault-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle id="vault-heading">Vault</SectionTitle>
            <TxLink href={`${explorer}/address/${vaultDetails.address}`} label="View the Vault on the Arc explorer">View on the explorer</TxLink>
          </div>

          <dl className="mt-4 divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
            {[
              ["Vault contract", <Address key="a" value={vaultDetails.address} full />],
              ["Implementation", vaultDetails.currentImplementation ? <Address key="i" value={vaultDetails.currentImplementation} full /> : "Can’t read it right now"],
              ["Owner", <Address key="o" value={vaultDetails.owner} full />],
              ["Steward wallet", vaultDetails.steward === zero ? "No Steward is set in this Vault" : <Address key="s" value={vaultDetails.steward} full />],
              ["Others who can record screenings", vaultDetails.screener === zero ? "Only you, the owner. Screenings come from Circle through the Compliance page." : <Address key="c" value={vaultDetails.screener} full />],
              ["Accounting decimals", vaultDetails.accountingDecimals],
            ].map(([label, value]) => (
              <div key={String(label)} className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">{label}</dt>
                <dd className="min-w-0 text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6">
            <SmallTitle as="h3">Currencies the Vault pays in</SmallTitle>
            <ul className="mt-3 flex flex-wrap gap-2">
              {vaultDetails.supportedTokens
                // USYC is the reserve, never a payment currency
                .filter((t) => t.symbol !== "USYC")
                .map((t, _i, shown) => (
                  <CurrencyRow
                    key={t.address}
                    businessId={business.id}
                    token={t}
                    signer={signer}
                    explorer={explorer}
                    isOwner={isOwner}
                    canTurnOff={shown.filter((x) => x.supported).length > 1}
                    onChanged={() => void handleRefresh()}
                  />
                ))}
            </ul>
            <p className="mt-2 max-w-[62ch] text-sm text-graphite">
              Turning a currency off applies at once. Turning one on loosens what the Vault can do, so it waits for your loosening delay like any other loosening change.
            </p>
          </div>

          <div className="mt-6 rounded-doc border border-rule px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <SmallTitle as="h3">Automatic updates</SmallTitle>
                <p className="mt-1 max-w-[62ch] text-sm text-graphite">
                  {vaultDetails.autoUpdate
                    ? "On. Releases published in the Symbolon release registry apply by themselves once your loosening delay has passed."
                    : "Off, which is the default. The Vault only changes when you schedule and apply a release yourself."}
                </p>
              </div>
              <StatusPill tone={vaultDetails.autoUpdate ? "info" : "neutral"}>{vaultDetails.autoUpdate ? "On" : "Off"}</StatusPill>
            </div>

            <p className="mt-3 max-w-[62ch] text-sm text-graphite">
              With this on, your Vault applies any release the registry publishes after your Vault’s delay, unless you switch it off or cancel. You trust the registry’s owner for this.
            </p>

            {isOwner ? (
              <div className="mt-4">
                <Button variant="secondary" busy={autoBusy} onClick={() => handleToggleAutoUpdate(!vaultDetails.autoUpdate)}>
                  {autoBusy ? "Updating…" : vaultDetails.autoUpdate ? "Turn off (at once)" : "Turn on (after the loosening delay)"}
                </Button>
              </div>
            ) : null}

            {autoSuccess ? <p role="status" className="mt-3 text-sm text-ok">{autoSuccess}</p> : null}
            {autoError ? <InlineError className="mt-3">{autoError}</InlineError> : null}
          </div>
        </section>
      ) : (
        <EmptyState title="No Vault yet">This business hasn’t deployed its Vault.</EmptyState>
      )}

      <section id="upgrades" aria-labelledby="upgrades-heading" className="scroll-mt-6">
        <SectionTitle id="upgrades-heading">Vault upgrades</SectionTitle>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">
          Your Vault is an upgradeable proxy and the upgrades are yours: you schedule one, wait out your delay, then apply it. No release changes your Vault without your wallet’s signature.
        </p>
        {business.vault ? (
          <ReleaseCard businessId={business.id} release={release} signer={signer} isOwner={isOwner} onRefresh={handleRefresh} explorer={explorer} />
        ) : (
          <EmptyState title="No Vault to upgrade yet" className="mt-4">Upgrades appear here once this business has a Vault.</EmptyState>
        )}
      </section>

      <section aria-labelledby="queued-heading">
        <SectionTitle id="queued-heading">Changes waiting</SectionTitle>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">
          Every change that loosens a limit (a relaxed policy, a bigger budget, a new currency, automatic updates) is queued onchain and waits for your delay before it applies.
        </p>
        <div className="mt-4">
          <QueuedChangeList businessId={business.id} signer={signer} explorer={explorer} onRefresh={handleRefresh} version={queueVersion} />
        </div>
      </section>
    </div>
  );
}
