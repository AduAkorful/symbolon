"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Avatar } from "@/components/Avatar";
import { postJson } from "@/lib/client/api";
import type { ProfileData } from "@/lib/server/profile";
import { formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";

export function ProfileView({ initialData }: { initialData: ProfileData }) {
  const router = useRouter();
  const { logout } = usePrivy();
  const [displayName, setDisplayName] = useState(initialData.user.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  async function handleCopyWallet() {
    if (!initialData.user.wallet) return;
    try {
      await navigator.clipboard.writeText(initialData.user.wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed
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
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="font-display text-4xl">Your profile</h1>
        <p className="mt-1 text-sm text-graphite">
          This is you across every business and Seal you belong to. How you're reached and signed in belongs to you.
        </p>
      </div>

      {problem ? (
        <div role="alert" className="rounded-doc border border-red/30 bg-red-wash px-4 py-2.5 text-sm text-red">
          {problem}
        </div>
      ) : null}

      {/* ─── Identity ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="identity-heading" className="space-y-4">
        <h2 id="identity-heading" className="font-display text-2xl">
          Identity
        </h2>
        <div className="flex flex-col gap-6 rounded-doc border border-rule p-5 sm:flex-row sm:items-start">
          <div className="flex-shrink-0">
            <Avatar name={userIdentifier} size={56} />
          </div>
          <div className="flex-1 space-y-4">
            <form onSubmit={handleSaveName} className="space-y-3">
              <div>
                <label htmlFor="display-name" className="block text-xs font-medium text-graphite">
                  Name shown to teammates
                </label>
                <div className="mt-1 flex max-w-md items-center gap-2">
                  <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    maxLength={80}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="e.g. Ana Ferreira"
                    className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink/50 focus:outline-none focus:ring-1 focus:ring-seal"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-ink/90 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-graphite">
                  This label is shown beside your verified email or wallet. It never identifies a signer on onchain documents.
                </p>
              </div>
              {saved ? (
                <span role="status" className="inline-block text-xs text-emerald-400">
                  Name updated.
                </span>
              ) : null}
            </form>

            <dl className="grid gap-3 border-t border-rule pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-graphite">Verified email</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {initialData.user.email ?? <span className="text-graphite">Not set (wallet sign-in)</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-graphite">Primary wallet</dt>
                <dd className="mt-0.5 font-mono text-xs text-ink">
                  {initialData.user.wallet ? (
                    <div className="flex items-center gap-2">
                      <Address value={initialData.user.wallet} full />
                      <button
                        type="button"
                        onClick={handleCopyWallet}
                        className="rounded border border-rule px-1.5 py-0.5 text-[11px] text-graphite hover:text-ink"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-graphite">None</span>
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-graphite">
              This is the wallet your Seal and your Vault ownership use. It's fixed when the account is made and can't be changed here.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Accounts you belong to ─────────────────────────────────────────── */}
      <section aria-labelledby="accounts-heading" className="space-y-4">
        <h2 id="accounts-heading" className="font-display text-2xl">
          Accounts you belong to
        </h2>
        <div className="divide-y divide-rule rounded-doc border border-rule">
          {initialData.accounts.seal ? (
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar name={initialData.accounts.seal.displayName} size={32} />
                <div>
                  <p className="font-medium text-ink">{initialData.accounts.seal.displayName}</p>
                  <p className="text-xs text-graphite">Signing Seal · @{initialData.accounts.seal.handle}</p>
                </div>
              </div>
              <Link
                href="/vendor"
                className="rounded-doc border border-rule px-3 py-1.5 text-xs text-graphite hover:border-ink/50 hover:text-ink"
              >
                Open Seal
              </Link>
            </div>
          ) : null}

          {initialData.accounts.businesses.map((biz) => (
            <div key={biz.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar name={biz.name} size={32} />
                <div>
                  <p className="font-medium text-ink">{biz.name}</p>
                  <p className="text-xs capitalize text-graphite">Business · {biz.role}</p>
                </div>
              </div>
              <Link
                href="/business"
                className="rounded-doc border border-rule px-3 py-1.5 text-xs text-graphite hover:border-ink/50 hover:text-ink"
              >
                Open Business
              </Link>
            </div>
          ))}

          {!initialData.accounts.seal && initialData.accounts.businesses.length === 0 ? (
            <p className="p-4 text-sm text-graphite">You don't belong to any Seal or business yet.</p>
          ) : null}
        </div>
      </section>

      {/* ─── Notifications Channels ─────────────────────────────────────────── */}
      <section aria-labelledby="notify-heading" className="space-y-4">
        <h2 id="notify-heading" className="font-display text-2xl">
          Notifications
        </h2>
        <div className="rounded-doc border border-rule p-5">
          <p className="text-sm text-ink">
            Notices appear inside the app. Email, Slack, Telegram and push delivery aren't available yet.
          </p>
          <div className="mt-4">
            <Link
              href="/notifications"
              className="inline-block rounded-doc border border-rule px-3.5 py-2 text-xs font-medium text-ink hover:border-ink/50"
            >
              View in-app notifications
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Sessions ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="sessions-heading" className="space-y-4">
        <h2 id="sessions-heading" className="font-display text-2xl">
          Active sessions
        </h2>
        <div className="space-y-4 rounded-doc border border-rule p-5">
          <ul className="divide-y divide-rule border-b border-rule">
            {initialData.sessions.map((sess) => (
              <li key={sess.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <span className="font-medium text-ink">
                    {sess.isCurrent ? "This device (current session)" : "Active session"}
                  </span>
                  <p className="font-mono text-xs text-graphite">
                    Last seen: {formatDateTime(new Date(sess.lastSeenAt))}
                  </p>
                </div>
                {sess.isCurrent ? (
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-400">
                    Current
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <div>
            <button
              onClick={handleSignOutEverywhere}
              disabled={signingOut}
              className="rounded-doc border border-rule px-4 py-2 text-xs font-medium text-red hover:border-red/40 hover:bg-red-wash disabled:opacity-50"
            >
              {signingOut ? "Signing out everywhere…" : "Sign out everywhere"}
            </button>
            <p className="mt-1.5 text-xs text-graphite">
              Ends every active session across all browsers and devices, including this one.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
