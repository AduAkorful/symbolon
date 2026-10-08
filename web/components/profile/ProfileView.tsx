"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Avatar } from "@/components/Avatar";
import { postJson } from "@/lib/client/api";
import type { ProfileData } from "@/lib/server/profile";
import { formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";
import { Button, LinkButton } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";

export function ProfileView({ initialData }: { initialData: ProfileData }) {
  const router = useRouter();
  const { logout } = usePrivy();
  const [displayName, setDisplayName] = useState(initialData.user.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [signingOut, startSignOut] = useTransition();

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setSaving(true);
    try {
      await postJson("/api/profile", { displayName });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't update name.");
      setSaved(false);
    } finally {
      setSaving(false);
    }
  }

  function handleSignOutEverywhere() {
    setProblem(null);
    startSignOut(async () => {
      try {
        await postJson("/api/auth/signout-all");
        await logout().catch(() => undefined);
        router.push("/signin");
        router.refresh();
      } catch (err) {
        setProblem(err instanceof Error ? err.message : "Couldn't sign out everywhere.");
      }
    });
  }

  const userIdentifier = displayName.trim() || initialData.user.email || initialData.user.wallet || "You";

  return (
    <div className="space-y-12">
      <div>
        <PageTitle>Your profile</PageTitle>
        <Lead className="mt-3">This is you across every business and Seal you belong to. How you’re reached and how you sign in belongs to you.</Lead>
      </div>

      {problem ? <InlineError>{problem}</InlineError> : null}

      <section aria-labelledby="identity-heading" className="space-y-4">
        <SectionTitle id="identity-heading">Identity</SectionTitle>
        <div className="flex flex-col gap-6 rounded-doc border border-rule px-6 py-6 sm:flex-row sm:items-start">
          <Avatar name={userIdentifier} size={56} />
          <div className="min-w-0 flex-1 space-y-6">
            <form onSubmit={handleSaveName} className="space-y-3">
              <Field label="Name shown to teammates" hint="Shown beside your verified email or wallet. It never identifies a signer on an onchain document.">
                {(a) => (
                  <div className="flex max-w-md gap-2">
                    <input {...a} type="text" value={displayName} maxLength={80} onChange={(e) => { setDisplayName(e.target.value); setSaved(false); }} placeholder="Ana Ferreira" className={controlClass} />
                    <Button type="submit" busy={saving}>{saving ? "Saving…" : "Save"}</Button>
                  </div>
                )}
              </Field>
              {saved ? <p role="status" className="text-sm text-ok">Name updated.</p> : null}
            </form>

            <dl className="divide-y divide-rule-soft border-t border-rule text-sm">
              <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">Verified email</dt>
                <dd className="font-medium text-ink">{initialData.user.email ?? <span className="font-normal text-graphite">None (you sign in with a wallet)</span>}</dd>
              </div>
              <div className="grid gap-1 py-3.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">Primary wallet</dt>
                <dd className="min-w-0 text-ink">
                  {initialData.user.wallet ? <Address value={initialData.user.wallet} full copy /> : <span className="text-graphite">None</span>}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-graphite">
              This is the wallet your Seal and your Vault ownership use. It is fixed when the account is made and can’t be changed here.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="accounts-heading" className="space-y-4">
        <SectionTitle id="accounts-heading">Accounts you belong to</SectionTitle>
        <ul className="divide-y divide-rule-soft rounded-doc border border-rule">
          {initialData.accounts.seal ? (
            <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={initialData.accounts.seal.displayName} size={32} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{initialData.accounts.seal.displayName}</p>
                  <p className="text-sm text-graphite">Signing Seal · @{initialData.accounts.seal.handle}</p>
                </div>
              </div>
              <LinkButton href="/vendor" variant="secondary" size="sm">Open the Seal</LinkButton>
            </li>
          ) : null}

          {initialData.accounts.businesses.map((biz) => (
            <li key={biz.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={biz.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{biz.name}</p>
                  <p className="text-sm capitalize text-graphite">Business · {biz.role}</p>
                </div>
              </div>
              <LinkButton href="/business" variant="secondary" size="sm">Open the business</LinkButton>
            </li>
          ))}

          {!initialData.accounts.seal && initialData.accounts.businesses.length === 0 ? (
            <li className="px-5 py-4 text-sm text-graphite">You don’t belong to any Seal or business yet.</li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="notify-heading" className="space-y-4">
        <SectionTitle id="notify-heading">Notifications</SectionTitle>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-doc border border-rule px-6 py-5">
          <p className="max-w-[60ch] text-sm text-ink">Notices appear inside the app. Email, Slack, Telegram and push delivery aren’t available yet.</p>
          <LinkButton href="/notifications" variant="secondary" size="sm">Open your notifications</LinkButton>
        </div>
      </section>

      <section aria-labelledby="sessions-heading" className="space-y-4">
        <SectionTitle id="sessions-heading">Active sessions</SectionTitle>
        <div className="rounded-doc border border-rule px-6 py-5">
          <ul className="divide-y divide-rule-soft border-b border-rule-soft">
            {initialData.sessions.map((sess) => (
              <li key={sess.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <span className="font-medium text-ink">{sess.isCurrent ? "This device" : "Another session"}</span>
                  <p className="text-graphite">Last seen {formatDateTime(new Date(sess.lastSeenAt))}</p>
                </div>
                {sess.isCurrent ? <StatusPill tone="ok">Current</StatusPill> : null}
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <Button variant="secondary" busy={signingOut} onClick={handleSignOutEverywhere}>
              {signingOut ? "Signing out…" : "Sign out everywhere"}
            </Button>
            <p className="mt-2 text-sm text-graphite">Ends every session on every browser and device, including this one.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
