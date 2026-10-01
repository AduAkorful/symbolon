"use client";

import { useState } from "react";
import Link from "next/link";
import { TxLink } from "@/components/TxLink";
import { QueuedChangeList } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { TeamMemberView, TeamViewData } from "@/lib/server/team";

interface TeamInvitationRow {
  id: string;
  role: string;
  budgets?: string[];
  label?: string | null;
  createdAt: string | Date;
  expiresAt: string | Date;
}

interface TeamViewProps extends TeamViewData {
  invitations: TeamInvitationRow[];
  signer: SignerPlan;
}

export function TeamView({
  business,
  currentUserRole,
  isVaultOwner,
  members,
  invitations: initialInvitations,
  signer,
}: TeamViewProps) {
  const [invitations, setInvitations] = useState<TeamInvitationRow[]>(initialInvitations);
  const [inviting, setInviting] = useState(false);
  const [inviteRole, setInviteRole] = useState<"approver" | "requester" | "viewer">("approver");
  const [inviteLabel, setInviteLabel] = useState("");
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Role action modals
  const [onchainTarget, setOnchainTarget] = useState<TeamMemberView | null>(null);
  const [onchainMode, setOnchainMode] = useState<"grant" | "revoke">("grant");
  const [onchainStatus, setOnchainStatus] = useState<string | null>(null);

  const getProviders = useWalletProviders();
  const isOwner = currentUserRole === "owner";

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{
        ok: boolean;
        invitation: { inviteUrl: string; id: string; role: string; expiresAt: string };
      }>(`/api/business/${business.id}/team`, {
        action: "invite",
        role: inviteRole,
        label: inviteLabel.trim() || undefined,
      });

      if (res.ok && res.invitation) {
        setCreatedInviteUrl(res.invitation.inviteUrl);
        setInvitations([
          {
            id: res.invitation.id,
            role: res.invitation.role,
            label: inviteLabel.trim() || null,
            createdAt: new Date(),
            expiresAt: res.invitation.expiresAt,
          },
          ...invitations,
        ]);
        setInviteLabel("");
      }
    } catch (err: any) {
      setError(err?.message || "Could not create invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    if (!confirm("Revoke this invitation? The secret link will immediately stop working.")) return;
    setBusy(true);
    try {
      await postJson(`/api/business/${business.id}/team`, {
        action: "revoke-invite",
        invitationId,
      });
      setInvitations(invitations.filter((i) => i.id !== invitationId));
    } catch (err: any) {
      alert(err?.message || "Failed to revoke invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(m: TeamMemberView) {
    if (m.appRole === "owner") return;
    if (
      m.onchainRole !== "none" &&
      m.onchainRole !== "unknown" &&
      m.onchainRole !== "owner"
    ) {
      alert(
        "This member currently holds onchain rights on the Vault. Revoke their onchain role first before removing them.",
      );
      return;
    }
    if (!confirm(`Are you sure you want to remove ${m.email || m.wallet} from the team?`)) return;

    setBusy(true);
    try {
      await postJson(`/api/business/${business.id}/team`, {
        action: "remove",
        targetUserId: m.userId,
      });
      window.location.reload();
    } catch (err: any) {
      alert(err?.message || "Failed to remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecuteOnchain(m: TeamMemberView, role: "approver" | "requester", enabled: boolean, budgetId?: string) {
    if (signer.kind !== "wallet") {
      alert("Please connect the business owner's wallet to execute this onchain change.");
      return;
    }
    setBusy(true);
    setOnchainStatus("Preparing onchain transaction...");
    try {
      const prep = await postJson<{
        to: string;
        data: string;
        state: string;
        summary: { title: string };
      }>(`/api/business/${business.id}/team`, {
        action: "prepare-onchain",
        targetUserId: m.userId,
        role,
        enabled,
        budgetId,
      });

      setOnchainStatus("Please confirm the transaction in your wallet...");
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      setOnchainStatus("Recording transaction receipt...");
      await postJson(`/api/business/${business.id}/team`, {
        action: "record-onchain",
        txHash,
      });

      alert(
        enabled
          ? "Onchain role submitted! Loosening changes may be queued onchain per your Vault's delay."
          : "Onchain role revoked immediately.",
      );
      window.location.reload();
    } catch (err: any) {
      alert(err?.message || "Onchain transaction failed.");
    } finally {
      setBusy(false);
      setOnchainStatus(null);
      setOnchainTarget(null);
    }
  }

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight text-ink">Team</h1>
          <p className="mt-2 max-w-[64ch] text-graphite text-sm leading-relaxed">
            Roles are enforced by the Vault. Giving someone more power is a loosening change, so it waits
            for your Vault's loosening delay. The Steward can never hold a role or count as an approver.
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => {
              setInviting(!inviting);
              setCreatedInviteUrl(null);
              setError(null);
            }}
            className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-ink/90 transition-colors"
          >
            {inviting ? "Close invite" : "Invite someone"}
          </button>
        )}
      </div>

      {/* Invite Modal / Box */}
      {inviting && (
        <div className="mt-6 max-w-3xl rounded-doc border border-rule bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-medium text-ink">Invite a team member</h2>
          <p className="mt-1 text-xs text-graphite">
            Send a single-use secret link. The invitee must have a connected wallet to accept.
          </p>

          {!createdInviteUrl ? (
            <form onSubmit={handleCreateInvite} className="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem_auto]">
              <div>
                <label className="block text-xs font-mono uppercase text-graphite mb-1">
                  Private Note (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ama (Finance Lead)"
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                  className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-graphite/50 focus:border-ink focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase text-graphite mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-ink focus:outline-none"
                >
                  <option value="approver">Approver</option>
                  <option value="requester">Requester</option>
                  <option value="viewer">Viewer (Read-only)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full sm:w-auto rounded-doc bg-ink px-5 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
                >
                  {busy ? "Creating..." : "Create Link"}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-4 rounded-doc border border-brass/40 bg-paper p-4">
              <span className="text-xs font-mono uppercase tracking-wider text-brass font-medium">
                Single-use invite link created
              </span>
              <p className="mt-1 text-xs text-graphite">
                This secret link is shown once. Send it directly to your team member over a channel you trust.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={createdInviteUrl}
                  className="flex-1 rounded-doc border border-rule bg-surface px-3 py-2 text-xs font-mono text-ink"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdInviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="rounded-doc border border-rule bg-paper px-3 py-2 text-xs font-medium text-ink hover:border-ink"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-crimson">{error}</p>}
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-mono uppercase tracking-wider text-graphite">Pending Invitations</h2>
          <div className="mt-3 divide-y divide-rule border-y border-rule">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-4 py-3 text-sm">
                <div>
                  <span className="font-medium text-ink capitalize">{inv.role}</span>
                  {inv.label && <span className="ml-2 text-xs text-graphite font-mono">({inv.label})</span>}
                  <span className="block text-xs text-graphite">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </span>
                </div>
                {isOwner && (
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="text-xs text-crimson hover:underline"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Members List */}
      <section className="mt-8">
        <h2 className="text-xs font-mono uppercase tracking-wider text-graphite mb-2">Team Members</h2>
        <ul className="divide-y divide-rule border-y border-ink">
          {members.map((m) => (
            <li key={m.userId} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">
                      {m.email || (m.wallet ? `${m.wallet.slice(0, 6)}...${m.wallet.slice(-4)}` : "Member")}
                    </span>
                    <span className="rounded bg-surface px-2 py-0.5 text-xs font-mono capitalize text-graphite border border-rule">
                      {m.appRole}
                    </span>
                    {m.appRole === "owner" && (
                      <span className="rounded bg-ink/10 px-2 py-0.5 text-xs font-mono text-ink">
                        Primary Owner
                      </span>
                    )}
                  </div>

                  {m.wallet && (
                    <span className="block mt-1 font-mono text-xs text-graphite select-all">
                      {m.wallet}
                    </span>
                  )}

                  {/* Onchain Role Badge */}
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-graphite">Vault Onchain Status:</span>
                    {m.onchainRole === "owner" ? (
                      <span className="font-mono text-ink font-medium">Vault Owner</span>
                    ) : m.onchainRole === "approver_all" ? (
                      <span className="font-mono text-emerald font-medium">Approver (all budgets)</span>
                    ) : m.onchainRole === "approver_scoped" ? (
                      <span className="font-mono text-emerald font-medium">Approver (scoped)</span>
                    ) : m.onchainRole === "requester" ? (
                      <span className="font-mono text-emerald font-medium">Requester</span>
                    ) : m.onchainRole === "unknown" ? (
                      <span className="font-mono text-graphite">Can't confirm onchain</span>
                    ) : (
                      <span className="font-mono text-graphite">Not granted onchain</span>
                    )}
                  </div>

                  {/* Mismatch Warning */}
                  {m.onchainMismatch && (
                    <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-700 dark:text-amber-300">
                      <p className="font-medium">Role Discrepancy:</p>
                      <p>{m.mismatchReason}</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {isOwner && m.appRole !== "owner" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Grant or Revoke onchain button */}
                    {m.appRole === "approver" && m.onchainRole !== "approver_all" && m.onchainRole !== "approver_scoped" && (
                      <button
                        onClick={() => handleExecuteOnchain(m, "approver", true)}
                        disabled={busy}
                        className="rounded-doc border border-ink bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                      >
                        Set Approver Onchain
                      </button>
                    )}
                    {m.appRole === "requester" && m.onchainRole !== "requester" && (
                      <button
                        onClick={() => handleExecuteOnchain(m, "requester", true)}
                        disabled={busy}
                        className="rounded-doc border border-ink bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                      >
                        Set Requester Onchain
                      </button>
                    )}
                    {m.activeApproverBudgets?.map((budgetId) => (
                      <button
                        key={budgetId}
                        onClick={() => handleExecuteOnchain(m, "approver", false, budgetId)}
                        disabled={busy}
                        className="rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-crimson hover:border-crimson"
                      >
                        Revoke approval grant {budgetId}
                      </button>
                    ))}
                    {m.onchainRole === "requester" && (
                      <button
                        onClick={() => handleExecuteOnchain(m, "requester", false)}
                        disabled={busy}
                        className="rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-crimson hover:border-crimson"
                      >
                        Revoke Requester Onchain
                      </button>
                    )}

                    <button
                      onClick={() => handleRemoveMember(m)}
                      disabled={busy}
                      className="rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-graphite hover:text-crimson hover:border-crimson"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {members.length === 1 && (
          <p className="mt-4 text-xs text-graphite">
            It's just you right now. Invite an approver or a requester when your business needs multi-person signoff.
          </p>
        )}
      </section>

      {/* Queued Changes for Role Updates */}
      <section className="mt-14 max-w-3xl">
        <h2 className="font-display text-2xl font-medium text-ink">Role Loosening Changes</h2>
        <p className="mt-1 text-xs text-graphite">
          Any change granting more onchain power waits for the Vault's loosening delay. Once the wait expires,
          the owner applies it with a matching signature.
        </p>
        <div className="mt-4">
          <QueuedChangeList
            businessId={business.id}
            signer={signer}
            onRefresh={() => window.location.reload()}
          />
        </div>
      </section>

      {onchainStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="rounded-doc bg-paper border border-rule p-6 max-w-sm w-full text-center shadow-lg">
            <h3 className="font-medium text-ink">Executing Onchain Change</h3>
            <p className="mt-2 text-xs text-graphite">{onchainStatus}</p>
          </div>
        </div>
      )}
    </main>
  );
}
