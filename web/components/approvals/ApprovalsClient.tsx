"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Overlay } from "@/components/Overlay";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import type { ApprovalItem, ApprovalsListResult } from "@/lib/server/approvals";

interface Props {
  businessId: string;
  data: ApprovalsListResult;
  signerPlan: SignerPlan;
  explorerUrl: string;
}

export function ApprovalsClient({ businessId, data, signerPlan, explorerUrl }: Props) {
  const router = useRouter();
  const discover = useWalletProviders();

  // Active modal state
  const [payNowItem, setPayNowItem] = useState<ApprovalItem | null>(null);
  const [signItem, setSignItem] = useState<ApprovalItem | null>(null);
  const [rejectItem, setRejectItem] = useState<ApprovalItem | null>(null);

  // Form & action state
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  // --- Pay Now Handler ---
  async function handlePayNow(item: ApprovalItem) {
    setActionLoading(true);
    setActionError(null);
    try {
      // 1. Prepare call on server (re-runs pipeline with user's level and simulates)
      const prepRes = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare-pay", fingerprint: item.fingerprint }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok || !prepData.ok) {
        throw new Error(prepData.reason || prepData.error || "Failed to prepare payment transaction.");
      }

      // 2. Send transaction with user's wallet
      const hash = await sendCall(
        signerPlan,
        { to: prepData.to, data: prepData.data },
        discover,
      );

      // 3. Record transaction receipt on server
      const recRes = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record-pay", txHash: hash, fingerprint: item.fingerprint }),
      });
      const recData = await recRes.json();
      if (!recRes.ok || !recData.ok) {
        throw new Error(recData.error || "Transaction was sent but could not be recorded.");
      }

      setLastTxHash(hash);
      setPayNowItem(null);
      router.refresh();
    } catch (err: any) {
      setActionError(err.message || "Failed to process payment.");
    } finally {
      setActionLoading(false);
    }
  }

  // --- Sign Approval Handler ---
  async function handleSignApproval(item: ApprovalItem) {
    setActionLoading(true);
    setActionError(null);
    try {
      // 1. Prepare approval message (typed data)
      const prepRes = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare-approval", fingerprint: item.fingerprint }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok || !prepData.ok) {
        throw new Error(prepData.error || "Failed to prepare approval message.");
      }

      if (signerPlan.kind === "none") {
        throw new Error(signerPlan.reason);
      }

      const providers = await discover();
      let activeProvider: any = null;
      for (const p of providers) {
        try {
          const accounts = (await p.request({ method: "eth_accounts" })) as string[];
          if (accounts.some((a) => a.toLowerCase() === signerPlan.address.toLowerCase())) {
            activeProvider = p;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!activeProvider) {
        throw new Error(`Your connected wallet does not match your Symbolon account address (${signerPlan.address}).`);
      }

      // Sign EIP-712 Approval message
      const signature = (await activeProvider.request({
        method: "eth_signTypedData_v4",
        params: [signerPlan.address, JSON.stringify(prepData.typedData)],
      })) as string;

      // 2. Submit approval to server
      const subRes = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-approval",
          fingerprint: item.fingerprint,
          deadline: prepData.deadline,
          signature,
        }),
      });
      const subData = await subRes.json();
      if (!subRes.ok || !subData.ok) {
        throw new Error(subData.error || "Failed to record approval.");
      }

      setSignItem(null);
      router.refresh();
    } catch (err: any) {
      setActionError(err.message || "Failed to sign approval.");
    } finally {
      setActionLoading(false);
    }
  }

  // --- Reject Handler ---
  async function handleReject(item: ApprovalItem) {
    if (!rejectionReason.trim() || rejectionReason.trim().length < 3) {
      setActionError("Please provide a rejection reason with at least 3 characters.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          fingerprint: item.fingerprint,
          reason: rejectionReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to reject invoice.");
      }

      setRejectItem(null);
      setRejectionReason("");
      router.refresh();
    } catch (err: any) {
      setActionError(err.message || "Failed to reject invoice.");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="max-w-[840px] space-y-12">
      {/* Header & Metric */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-4xl leading-tight">Approvals</h1>
          {data.humanMetric ? (
            <div className="rounded-full border border-rule bg-paper-raised px-4 py-1.5 font-mono text-xs text-graphite">
              {data.humanMetric.text}
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-graphite">
          Payments that require human authorization under your Vault’s policy. The Steward recommends; you decide.
        </p>
      </div>

      {lastTxHash ? (
        <div className="rounded-doc border border-seal/40 bg-seal/5 p-4 text-sm text-seal">
          Payment confirmed onchain.{" "}
          <TxLink href={`${explorerUrl}/tx/${lastTxHash}`} label="View transaction on Arc" className="underline font-mono">
            {lastTxHash.slice(0, 10)}…{lastTxHash.slice(-8)}
          </TxLink>
        </div>
      ) : null}

      {/* Awaiting Approvals List */}
      <section aria-labelledby="awaiting-title" className="space-y-6">
        <h2 id="awaiting-title" className="text-xs uppercase tracking-[0.14em] text-graphite">
          Waiting for your decision ({data.items.length})
        </h2>

        {data.items.length === 0 ? (
          <div className="rounded-doc border border-rule-soft bg-paper-raised p-8 text-center text-graphite">
            Nothing is waiting for you. All approved payments are either processed or up to date.
          </div>
        ) : (
          <div className="space-y-6">
            {data.items.map((item) => (
              <article
                key={item.fingerprint}
                className="rounded-doc border border-rule bg-paper-raised p-6 transition-colors hover:border-rule-strong"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-ink">{item.invoiceNumber}</span>
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                        item.vendor.trust === "verified"
                          ? "bg-seal/10 text-seal"
                          : item.vendor.trust === "blocked"
                          ? "bg-red/10 text-red"
                          : "bg-paper text-graphite"
                      }`}
                    >
                      {item.vendor.trust === "verified"
                        ? "Verified payee"
                        : item.vendor.trust === "blocked"
                        ? "Blocked vendor"
                        : "New vendor"}
                    </span>
                  </div>
                  <Link
                    href={`/business/inbox/${item.fingerprint}`}
                    className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    View invoice details →
                  </Link>
                </div>

                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-xl font-medium text-ink">{item.vendor.name}</h3>
                  <div className="font-mono text-2xl font-medium text-ink">
                    ${item.amountFormatted} <span className="text-sm font-normal text-graphite">{item.token}</span>
                  </div>
                </div>

                {/* Recommendation summary sentence */}
                <div className="mt-4 rounded-md border border-rule-soft bg-paper p-3 text-sm">
                  <p className="text-ink">{item.stewardSentence}</p>
                  {item.explanation ? (
                    <p className="mt-1 text-xs text-graphite">{item.explanation}</p>
                  ) : null}
                  <p className="mt-2 text-xs font-mono uppercase tracking-wider text-graphite">
                    Rule triggered: {item.ruleNeededHuman} ({item.requiredLevel} sign-off required)
                  </p>
                </div>

                {/* Evidence summary */}
                {item.evidence.length > 0 ? (
                  <div className="mt-4 border-t border-rule-soft pt-3">
                    <p className="text-xs uppercase tracking-wider text-graphite">Evidence checks</p>
                    <div className="mt-2 space-y-1.5">
                      {item.evidence.slice(0, 3).map((ev, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <span
                            className={
                              ev.state === "holds"
                                ? "text-seal"
                                : ev.state === "blocks"
                                ? "text-red"
                                : "text-graphite"
                            }
                          >
                            {ev.state === "holds" ? "✓" : ev.state === "blocks" ? "✕" : "–"}
                          </span>
                          <span className="text-ink font-medium">{ev.label}:</span>
                          <span className="text-graphite">{ev.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Action buttons */}
                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
                  {item.canPayNow ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setPayNowItem(item);
                      }}
                      className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
                    >
                      Approve and pay
                    </button>
                  ) : null}

                  {item.canSign ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setSignItem(item);
                      }}
                      className="rounded-doc border border-rule px-4 py-2 text-sm font-medium text-ink hover:border-ink"
                    >
                      Approve (sign)
                    </button>
                  ) : null}

                  {item.canReject ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setRejectionReason("");
                        setRejectItem(item);
                      }}
                      className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:border-red hover:text-red"
                    >
                      Reject
                    </button>
                  ) : null}

                  {!item.canPayNow && !item.canSign && !item.canReject ? (
                    <p className="text-xs text-graphite">
                      Your current role or connected wallet does not have permissions to approve or pay this invoice.
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Recent Answers Section */}
      {data.recentAnswers.length > 0 ? (
        <section aria-labelledby="recent-title" className="space-y-4 border-t border-rule pt-8">
          <h2 id="recent-title" className="text-xs uppercase tracking-[0.14em] text-graphite">
            Recent decisions & responses
          </h2>
          <div className="divide-y divide-rule-soft rounded-doc border border-rule bg-paper-raised">
            {data.recentAnswers.map((ans) => (
              <div key={ans.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs uppercase tracking-wider ${
                        ans.kind === "approval_granted" ? "text-seal" : "text-red"
                      }`}
                    >
                      {ans.kind === "approval_granted" ? "Approval granted" : "Approval rejected"}
                    </span>
                    <span className="text-xs text-graphite">
                      {new Date(ans.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {ans.reason ? <p className="mt-1 text-xs text-graphite">Reason: {ans.reason}</p> : null}
                </div>
                <Link
                  href={`/business/decisions/${ans.id}`}
                  className="text-xs text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  View decision →
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* --- Modal: Approve and Pay --- */}
      {payNowItem ? (
        <Overlay label="Approve and pay payment" onClose={() => setPayNowItem(null)}>
          <div className="p-6 md:p-8">
            <h2 className="font-display text-2xl">Approve and pay</h2>
            <p className="mt-2 text-sm text-graphite">
              Your wallet will send this payment directly to the Vault. The transaction will clear on Arc immediately.
            </p>

            <dl className="mt-6 divide-y divide-rule-soft rounded-doc border border-rule bg-paper p-4 text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Vendor</dt>
                <dd className="font-medium text-ink">{payNowItem.vendor.name}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Invoice number</dt>
                <dd className="font-mono text-ink">{payNowItem.invoiceNumber}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Payment amount</dt>
                <dd className="font-mono font-medium text-ink">
                  ${payNowItem.amountFormatted} {payNowItem.token}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Authorizing wallet</dt>
                <dd className="font-mono text-xs text-ink">{data.userWallet ?? "Connected wallet"}</dd>
              </div>
            </dl>

            {actionError ? (
              <p className="mt-4 rounded bg-red/10 p-3 text-xs text-red">{actionError}</p>
            ) : null}

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPayNowItem(null)}
                disabled={actionLoading}
                className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handlePayNow(payNowItem)}
                disabled={actionLoading}
                className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
              >
                {actionLoading ? "Sending transaction…" : "Confirm and pay"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}

      {/* --- Modal: Sign Approval --- */}
      {signItem ? (
        <Overlay label="Sign EIP-712 approval" onClose={() => setSignItem(null)}>
          <div className="p-6 md:p-8">
            <h2 className="font-display text-2xl">Sign payment approval</h2>
            <p className="mt-2 text-sm text-graphite">
              You are signing an offchain EIP-712 approval. The Steward will include this signature and execute the payment on its next autonomous run. No gas fee is required to sign.
            </p>

            <dl className="mt-6 divide-y divide-rule-soft rounded-doc border border-rule bg-paper p-4 text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Vendor</dt>
                <dd className="font-medium text-ink">{signItem.vendor.name}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Credit to settle</dt>
                <dd className="font-mono font-medium text-ink">
                  ${signItem.amountFormatted} {signItem.token}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Validity period</dt>
                <dd className="text-xs text-ink">24 hours from signing</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-graphite">Signer</dt>
                <dd className="font-mono text-xs text-ink">{data.userWallet ?? "Connected wallet"}</dd>
              </div>
            </dl>

            {actionError ? (
              <p className="mt-4 rounded bg-red/10 p-3 text-xs text-red">{actionError}</p>
            ) : null}

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSignItem(null)}
                disabled={actionLoading}
                className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSignApproval(signItem)}
                disabled={actionLoading}
                className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
              >
                {actionLoading ? "Signing…" : "Sign approval"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}

      {/* --- Modal: Reject Approval --- */}
      {rejectItem ? (
        <Overlay label="Reject invoice approval" onClose={() => setRejectItem(null)}>
          <div className="p-6 md:p-8">
            <h2 className="font-display text-2xl">Reject invoice</h2>
            <p className="mt-2 text-sm text-graphite">
              Rejecting puts the invoice on human hold. The Steward will not re-evaluate or attempt to pay it until an owner releases the hold.
            </p>

            <div className="mt-6 space-y-2">
              <label htmlFor="reject-reason" className="block text-xs uppercase tracking-wider text-graphite">
                Reason for rejection (required, 3–500 characters)
              </label>
              <textarea
                id="reject-reason"
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this invoice is being rejected…"
                className="w-full rounded-md border border-rule bg-paper p-3 text-sm text-ink placeholder:text-graphite focus:border-ink focus:outline-none"
              />
            </div>

            {actionError ? (
              <p className="mt-4 rounded bg-red/10 p-3 text-xs text-red">{actionError}</p>
            ) : null}

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRejectItem(null)}
                disabled={actionLoading}
                className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleReject(rejectItem)}
                disabled={actionLoading}
                className="rounded-doc bg-red px-4 py-2 text-sm font-medium text-white hover:bg-red/90 disabled:opacity-50"
              >
                {actionLoading ? "Rejecting…" : "Confirm rejection"}
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}
