"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Overlay } from "@/components/Overlay";
import { QueuedChangeList } from "@/components/QueuedChange";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import type { TeamMemberView, TeamViewData } from "@/lib/server/team";
import { formatDay, shortAddress } from "@/lib/format";
import { Address } from "@/components/Address";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";

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
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "revoke"; invitation: TeamInvitationRow } | { kind: "remove"; member: TeamMemberView } | null>(null);

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
    setBusy(true);
    setNotice(null);
    try {
      await postJson(`/api/business/${business.id}/team`, { action: "revoke-invite", invitationId });
      setInvitations(invitations.filter((i) => i.id !== invitationId));
      setConfirm(null);
    } catch (err: any) {
      setConfirm(null);
      setProblem(err?.message || "Couldn’t withdraw that invitation.");
    } finally {
      setBusy(false);
    }
  }

  function askRemoveMember(m: TeamMemberView) {
    if (m.appRole === "owner") return;
    if (m.onchainRole !== "none" && m.onchainRole !== "unknown" && m.onchainRole !== "owner") {
      setProblem("This person holds a role in the Vault. Revoke their onchain role first, then remove them.");
      return;
    }
    setConfirm({ kind: "remove", member: m });
  }

  async function handleRemoveMember(m: TeamMemberView) {
    setBusy(true);
    try {
      await postJson(`/api/business/${business.id}/team`, { action: "remove", targetUserId: m.userId });
      window.location.reload();
    } catch (err: any) {
      setConfirm(null);
      setProblem(err?.message || "Couldn’t remove that person.");
    } finally {
      setBusy(false);
    }
  }

  async function handleExecuteOnchain(m: TeamMemberView, role: "approver" | "requester", enabled: boolean, budgetId?: string) {
    if (signer.kind !== "wallet") {
      setProblem("Connect the owner’s wallet to make this change onchain.");
      return;
    }
    setProblem(null);
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

      window.location.reload();
    } catch (err: any) {
      setProblem(err?.message || "The onchain change didn’t go through.");
    } finally {
      setBusy(false);
      setOnchainStatus(null);
      setOnchainTarget(null);
    }
  }

  const nameOf = (m: TeamMemberView) => m.displayName || m.email || (m.wallet ? shortAddress(m.wallet) : "Member");
  const onchainLabel = (m: TeamMemberView) =>
    m.onchainRole === "owner" ? { text: "Vault owner", tone: "neutral" as const }
    : m.onchainRole === "approver_all" ? { text: "Approver, all budgets", tone: "ok" as const }
    : m.onchainRole === "approver_scoped" ? { text: "Approver, some budgets", tone: "ok" as const }
    : m.onchainRole === "requester" ? { text: "Requester", tone: "ok" as const }
    : m.onchainRole === "unknown" ? { text: "Can’t confirm", tone: "warn" as const }
    : { text: "No role in the Vault", tone: "neutral" as const };

  return (
    <div className="pb-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Team</PageTitle>
          <Lead className="mt-3">
            The Vault enforces these roles. Giving someone more power is a loosening change, so it waits for your Vault’s delay. The Steward can never hold a role or count as an approver.
          </Lead>
        </div>
        {isOwner ? (
          <Button onClick={() => { setInviting(true); setCreatedInviteUrl(null); setError(null); }}>Invite someone</Button>
        ) : null}
      </div>

      {problem ? <Callout tone="danger" onDismiss={() => setProblem(null)} className="mt-6">{problem}</Callout> : null}
      {notice ? <Callout tone="info" onDismiss={() => setNotice(null)} className="mt-6">{notice}</Callout> : null}

      {/* Invite */}
      {inviting ? (
        <Overlay
          title={createdInviteUrl ? "Send this link" : "Invite a team member"}
          description={createdInviteUrl ? "It is shown once. Send it over a channel you trust; it works once." : "They get a single-use secret link, and need a connected wallet to accept it."}
          onClose={() => { if (!busy) setInviting(false); }}
        >
          {createdInviteUrl ? (
            <>
              <Field label="Invitation link">
                {(a) => <input {...a} readOnly value={createdInviteUrl} onFocus={(e) => e.currentTarget.select()} className={`${controlClass} font-mono`} />}
              </Field>
              <Overlay.Footer>
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(createdInviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied" : "Copy the link"}
                </Button>
                <Button onClick={() => setInviting(false)}>Done</Button>
              </Overlay.Footer>
            </>
          ) : (
            <form onSubmit={handleCreateInvite} className="space-y-4">
              {error ? <InlineError>{error}</InlineError> : null}
              <Field label="Their role">
                {(a) => (
                  <select {...a} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)} className={controlClass}>
                    <option value="approver">Approver: can approve payments</option>
                    <option value="requester">Requester: can ask for payments</option>
                    <option value="viewer">Viewer: read only</option>
                  </select>
                )}
              </Field>
              <Field label="Note to yourself" optional hint="Only you see this, for example “Ama, finance lead”.">
                {(a) => <input {...a} type="text" value={inviteLabel} onChange={(e) => setInviteLabel(e.target.value)} className={controlClass} />}
              </Field>
              <Overlay.Footer>
                <Button variant="secondary" onClick={() => setInviting(false)}>Cancel</Button>
                <Button type="submit" busy={busy}>{busy ? "Creating…" : "Create the link"}</Button>
              </Overlay.Footer>
            </form>
          )}
        </Overlay>
      ) : null}

      {/* Pending invitations */}
      {invitations.length > 0 ? (
        <section className="mt-10" aria-labelledby="pending-heading">
          <SectionTitle id="pending-heading">Open invitations</SectionTitle>
          <ul className="mt-3 divide-y divide-rule-soft border-y border-rule">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium capitalize text-ink">{inv.role}{inv.label ? <span className="ml-2 font-normal text-graphite">{inv.label}</span> : null}</p>
                  <p className="text-sm text-graphite">Expires {formatDay(new Date(inv.expiresAt))}</p>
                </div>
                {isOwner ? <Button variant="danger" size="sm" onClick={() => setConfirm({ kind: "revoke", invitation: inv })}>Withdraw</Button> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Members */}
      <section className="mt-10" aria-labelledby="members-heading">
        <SectionTitle id="members-heading">Members</SectionTitle>
        <ul className="mt-3 divide-y divide-rule-soft border-y border-ink">
          {members.map((m) => {
            const onchain = onchainLabel(m);
            return (
              <li key={m.userId} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-ink">{nameOf(m)}</span>
                      <StatusPill tone="neutral" className="capitalize">{m.appRole}</StatusPill>
                    </p>
                    {m.displayName && m.email ? <p className="mt-0.5 text-sm text-graphite">{m.email}</p> : null}
                    {m.wallet ? <div className="mt-1 text-sm text-graphite"><Address value={m.wallet} full /></div> : null}
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-graphite">In the Vault:</span>
                      <StatusPill tone={onchain.tone}>{onchain.text}</StatusPill>
                    </p>
                    {m.onchainMismatch ? (
                      <Callout tone="warn" title="The app and the Vault disagree" className="mt-3">{m.mismatchReason}</Callout>
                    ) : null}
                  </div>

                  {isOwner && m.appRole !== "owner" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {m.appRole === "approver" && m.onchainRole !== "approver_all" && m.onchainRole !== "approver_scoped" ? (
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleExecuteOnchain(m, "approver", true)}>Make approver in the Vault</Button>
                      ) : null}
                      {m.appRole === "requester" && m.onchainRole !== "requester" ? (
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleExecuteOnchain(m, "requester", true)}>Make requester in the Vault</Button>
                      ) : null}
                      {m.activeApproverBudgets?.map((budgetId) => (
                        <Button key={budgetId} variant="secondary" size="sm" disabled={busy} onClick={() => handleExecuteOnchain(m, "approver", false, budgetId)}>Revoke approval grant {budgetId.slice(0, 8)}…</Button>
                      ))}
                      {m.onchainRole === "requester" ? (
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => handleExecuteOnchain(m, "requester", false)}>Revoke requester role</Button>
                      ) : null}
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => askRemoveMember(m)}>Remove</Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {members.length === 1 ? (
          <p className="mt-4 text-sm text-graphite">It’s just you for now. Invite an approver or a requester when your business needs more than one signature.</p>
        ) : null}
      </section>

      {/* Waiting role changes */}
      <section className="mt-14" aria-labelledby="loosening-heading">
        <SectionTitle id="loosening-heading">Role changes waiting</SectionTitle>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">
          Any change that gives someone more onchain power waits for the Vault’s delay. When it is over, the owner applies it with a matching signature.
        </p>
        <div className="mt-4">
          <QueuedChangeList businessId={business.id} signer={signer} onRefresh={() => window.location.reload()} />
        </div>
      </section>

      {confirm?.kind === "revoke" ? (
        <ConfirmDialog title="Withdraw this invitation?" confirmLabel="Withdraw it" destructive busy={busy} onConfirm={() => handleRevokeInvite(confirm.invitation.id)} onClose={() => setConfirm(null)}>
          The secret link stops working at once. You can invite them again with a new one.
        </ConfirmDialog>
      ) : null}
      {confirm?.kind === "remove" ? (
        <ConfirmDialog title={`Remove ${nameOf(confirm.member)}?`} confirmLabel="Remove them" destructive busy={busy} onConfirm={() => handleRemoveMember(confirm.member)} onClose={() => setConfirm(null)}>
          They lose access to this business in Symbolon. You can invite them again later.
        </ConfirmDialog>
      ) : null}

      {onchainStatus ? (
        <Overlay title="Sending the change to Arc" dismissible={false} onClose={() => undefined}>
          <p role="status" className="text-graphite">{onchainStatus}</p>
        </Overlay>
      ) : null}
    </div>
  );
}
