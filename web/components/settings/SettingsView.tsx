"use client";

import Link from "next/link";
import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { QueuedChangeList } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { SettingsViewData } from "@/lib/server/settings";
import type { ReleaseViewInfo, ReleaseNudgeResult } from "@/lib/server/release";
import { Rename } from "./Rename";
import { ReleaseCard } from "./ReleaseCard";
import { ReleaseNudge } from "./ReleaseNudge";

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

  const { business, vaultDetails, release, nudge } = data;

  async function handleRefresh() {
    try {
      const res = await fetch(`/api/business/${business.id}/settings`);
      if (res.ok) {
        const fresh = await res.json();
        setData(fresh);
      }
    } catch {
      // ignore
    }
  }

  async function handleToggleAutoUpdate(targetState: boolean) {
    setAutoBusy(true);
    setAutoError(null);
    setAutoSuccess(null);
    try {
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
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      const rec = await postJson<{ ok: boolean; status?: string }>(
        `/api/business/${business.id}/settings`,
        {
          action: "record-auto-update",
          txHash,
        },
      );

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

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-graphite">
          Organization name, Vault parameters, implementation upgrades, and role links.
        </p>
      </div>

      <ReleaseNudge nudge={nudge} />

      {/* Organization Section */}
      <section className="rounded-doc border border-rule bg-paper p-6">
        <h2 className="text-base font-semibold">Organization</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-graphite mb-1">Business Name</label>
            <Rename
              businessId={business.id}
              initialName={business.name}
              isOwner={isOwner}
              onRenamed={(newName) => {
                setData((prev) => ({
                  ...prev,
                  business: { ...prev.business, name: newName },
                }));
              }}
            />
          </div>
          <div>
            <label className="block text-xs text-graphite mb-1">Your Role</label>
            <p className="font-mono text-sm uppercase">{userRole}</p>
          </div>
        </div>

        <div className="mt-6 border-t border-rule pt-4 flex flex-wrap gap-4 text-xs">
          <Link
            href="/business/team"
            className="rounded-doc border border-rule px-3 py-1.5 hover:border-ink"
          >
            Manage Team & Roles →
          </Link>
          <Link
            href="/business/policy"
            className="rounded-doc border border-rule px-3 py-1.5 hover:border-ink"
          >
            Policy & Rules Editor →
          </Link>
          <Link
            href="/business/treasury"
            className="rounded-doc border border-rule px-3 py-1.5 hover:border-ink"
          >
            Treasury & Early Pay →
          </Link>
        </div>
      </section>

      {/* Vault Details Section */}
      {vaultDetails ? (
        <section className="rounded-doc border border-rule bg-paper p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Vault Details</h2>
            <TxLink
              href={`${explorer}/address/${vaultDetails.address}`}
              label="View Vault on explorer"
              className="text-xs font-sans"
            >
              View on Explorer
            </TxLink>

          </div>

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 border-t border-rule pt-4">
            <div>
              <dt className="text-graphite">Vault Contract</dt>
              <dd className="font-mono text-ink mt-0.5 break-all">{vaultDetails.address}</dd>
            </div>
            <div>
              <dt className="text-graphite">Current Implementation (EIP-1967)</dt>
              <dd className="font-mono text-ink mt-0.5 break-all">
                {vaultDetails.currentImplementation ?? "Reading slot..."}
              </dd>
            </div>
            <div>
              <dt className="text-graphite">Vault Owner</dt>
              <dd className="font-mono text-ink mt-0.5 break-all">{vaultDetails.owner}</dd>
            </div>
            <div>
              <dt className="text-graphite">Steward Wallet</dt>
              <dd className="font-mono text-ink mt-0.5 break-all">
                {vaultDetails.steward === "0x0000000000000000000000000000000000000000"
                  ? "None assigned"
                  : vaultDetails.steward}
              </dd>
            </div>
            <div>
              <dt className="text-graphite">Compliance Screener</dt>
              <dd className="font-mono text-ink mt-0.5 break-all">
                {vaultDetails.screener === "0x0000000000000000000000000000000000000000"
                  ? "None (internal checks only)"
                  : vaultDetails.screener}
              </dd>
            </div>
            <div>
              <dt className="text-graphite">Accounting Decimals</dt>
              <dd className="font-mono text-ink mt-0.5">{vaultDetails.accountingDecimals}</dd>
            </div>
          </dl>

          {/* Supported Tokens */}
          <div className="mt-6 border-t border-rule pt-4">
            <h3 className="text-xs font-medium text-graphite uppercase tracking-wider mb-2">
              Supported Tokens
            </h3>
            <div className="flex flex-wrap gap-2">
              {vaultDetails.supportedTokens.map((t) => (
                <div
                  key={t.address}
                  className="flex items-center gap-2 rounded-doc border border-rule px-3 py-1 text-xs"
                >
                  <span className="font-medium">{t.symbol}</span>
                  <span className="font-mono text-[10px] text-graphite">{t.address.slice(0, 6)}…</span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[10px] ${
                      t.supported ? "bg-seal-wash text-seal" : "bg-rule-soft text-graphite"
                    }`}
                  >
                    {t.supported ? "Active" : "Disabled"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Automatic Updates Toggle Card */}
          <div className="mt-6 rounded-doc border border-rule/70 bg-paper-raised p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Automatic Updates</p>
                <p className="mt-1 text-xs text-graphite max-w-xl">
                  {vaultDetails.autoUpdate
                    ? "Enabled. Published releases from the Symbolon Release Registry apply automatically after your loosening delay."
                    : "Off by default. Your Vault only changes when you explicitly schedule and apply releases."}
                </p>
              </div>
              <span
                className={`font-mono text-xs uppercase px-2 py-0.5 rounded ${
                  vaultDetails.autoUpdate ? "bg-seal-wash text-seal" : "bg-rule-soft text-graphite"
                }`}
              >
                {vaultDetails.autoUpdate ? "On" : "Off"}
              </span>
            </div>

            <p className="mt-3 text-xs text-graphite italic">
              "Your Vault will apply any release the Symbolon release registry publishes, after your
              Vault's delay, unless you switch this off or cancel. The registry's owner is trusted for this."
            </p>

            {isOwner && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleToggleAutoUpdate(!vaultDetails.autoUpdate)}
                  disabled={autoBusy}
                  className="rounded-doc border border-rule px-3 py-1.5 text-xs hover:border-ink disabled:opacity-50"
                >
                  {autoBusy
                    ? "Updating..."
                    : vaultDetails.autoUpdate
                      ? "Turn off (immediate)"
                      : "Turn on (waits loosening delay)"}
                </button>
              </div>
            )}

            {autoSuccess && <p className="mt-2 text-xs text-seal">{autoSuccess}</p>}
            {autoError && <p className="mt-2 text-xs text-red">{autoError}</p>}
          </div>
        </section>
      ) : (
        <section className="rounded-doc border border-rule bg-paper p-6 text-sm text-graphite">
          No Vault deployed for this business yet.
        </section>
      )}

      {/* Upgrades Section */}
      <section id="upgrades" className="rounded-doc border border-rule bg-paper p-6 scroll-mt-6">
        <h2 className="text-base font-semibold">Vault Implementation Upgrades</h2>
        <p className="mt-1 text-xs text-graphite">
          Your Vault is an upgradeable UUPS proxy. Upgrades are owned by you: you schedule them, wait out your
          delay, then apply them. No release changes your state without your explicit wallet signature.
        </p>

        <ReleaseCard
          businessId={business.id}
          release={release}
          signer={signer}
          isOwner={isOwner}
          onRefresh={handleRefresh}
        />
      </section>

      {/* Queued Loosening Changes Section */}
      <section className="rounded-doc border border-rule bg-paper p-6">
        <h2 className="text-base font-semibold">Queued Changes & Delay Pipeline</h2>
        <p className="mt-1 text-xs text-graphite">
          Every loosening change (policy relaxation, budget increases, token approvals, auto-update)
          is queued onchain and waits your delay before applying.
        </p>

        <div className="mt-4">
          <QueuedChangeList
            businessId={business.id}
            signer={signer}
            explorer={explorer}
            onRefresh={handleRefresh}
          />
        </div>
      </section>
    </div>
  );
}
