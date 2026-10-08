"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Address } from "@/components/Address";
import { Overlay } from "@/components/Overlay";
import { Button } from "@/components/ui/button";
import { DetailList } from "@/components/ui/DetailList";
import { Field, textareaClass } from "@/components/ui/Field";
import { Callout } from "@/components/ui/Callout";
import { Money } from "@/components/ui/Money";
import { StatusPill } from "@/components/ui/StatusPill";
import { EmptyState, InlineError } from "@/components/ui/States";
import { sendCall, type SignerPlan } from "@/components/setup/owner-signer";
import { TxLink } from "@/components/TxLink";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { signTypedData } from "@/components/vendor/seal-signer";
import type { ApprovalItem, ApprovalsListResult } from "@/lib/server/approvals";
import type { businessOffers } from "@/lib/server/offers";
import { BusinessOffers } from "@/components/inbox/BusinessOffers";
import { formatDay, showMoney } from "@/lib/format";
import { Eyebrow, Lead, PageTitle, SectionTitle, SmallTitle } from "@/components/ui/Type";

interface Props {
  businessId: string;
  data: ApprovalsListResult;
  signerPlan: SignerPlan;
  explorerUrl: string;
  offerViews?: Record<string, Awaited<ReturnType<typeof businessOffers>>>;
}

export function ApprovalsClient({ businessId, data, signerPlan, explorerUrl, offerViews }: Props) {
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

      if (typeof prepData.typedDataJson !== "string") {
        throw new Error("The prepared approval signing payload is missing.");
      }
      // Select the account's wallet, switch to Arc, and forward the server's exact JSON unchanged.
      const signature = await signTypedData(signerPlan, prepData.typedDataJson, discover);

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
    <div className="space-y-12">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <PageTitle>Approvals</PageTitle>
          {data.humanMetric ? <StatusPill tone="neutral">{data.humanMetric.text}</StatusPill> : null}
        </div>
        <Lead className="mt-3">Payments your Vault’s policy says need a person. The Steward recommends; you decide.</Lead>
      </div>

      {lastTxHash ? (
        <Callout tone="ok" title="Payment confirmed onchain">
          <TxLink href={`${explorerUrl}/tx/${lastTxHash}`} label="View transaction on Arc">
            {lastTxHash.slice(0, 10)}…{lastTxHash.slice(-8)}
          </TxLink>
        </Callout>
      ) : null}

      {/* Waiting for a decision */}
      <section aria-labelledby="awaiting-title" className="space-y-5">
        <SectionTitle id="awaiting-title">
          Waiting for your decision <span className="text-graphite">({data.items.length})</span>
        </SectionTitle>

        {data.items.length === 0 ? (
          <EmptyState title="Nothing is waiting for you">Payments that need a person show up here. Everything else is processed or up to date.</EmptyState>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {data.items.map((item) => (
              <article key={item.fingerprint} className="flex min-w-0 flex-col rounded-doc border border-rule bg-paper-raised px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-graphite">Invoice {item.invoiceNumber}</span>
                    <StatusPill tone={item.vendor.trust === "verified" ? "ok" : item.vendor.trust === "blocked" ? "danger" : "neutral"}>
                      {item.vendor.trust === "verified" ? "Verified payee" : item.vendor.trust === "blocked" ? "Blocked vendor" : "New vendor"}
                    </StatusPill>
                  </div>
                  <Link href={`/business/inbox/${item.fingerprint}`} className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
                    Invoice details →
                  </Link>
                </div>

                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <SmallTitle as="h3" className="min-w-0 text-xl">{item.vendor.name}</SmallTitle>
                  <Money className="font-display text-3xl text-ink">{showMoney(item.amountFormatted, item.token)}</Money>
                </div>

                <div className="mt-4 rounded-doc border border-rule-soft bg-paper px-4 py-3 text-sm">
                  <p className="text-ink">{item.stewardSentence}</p>
                  {item.explanation ? <p className="mt-1 text-graphite">{item.explanation}</p> : null}
                  <p className="mt-2 text-graphite">
                    Needs a person because: {item.ruleNeededHuman}. {item.requiredLevel === "owner" ? "The owner has to sign it off." : "An approver or the owner can sign it off."}
                  </p>
                </div>

                {offerViews?.[item.fingerprint] ? <BusinessOffers businessId={businessId} fingerprint={item.fingerprint} view={offerViews[item.fingerprint]!} symbol={item.token} /> : null}
                {item.evidence.length > 0 ? (
                  <div className="mt-4 border-t border-rule-soft pt-3">
                    <Eyebrow>Checks</Eyebrow>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {item.evidence.slice(0, 3).map((ev, idx) => (
                        <li key={idx} className="flex items-baseline gap-2">
                          <span aria-hidden className={ev.state === "holds" ? "text-ok" : ev.state === "blocks" ? "text-red" : "text-graphite"}>
                            {ev.state === "holds" ? "✓" : ev.state === "blocks" ? "✕" : "–"}
                          </span>
                          <span className="font-medium text-ink">{ev.label}:</span>
                          <span className="min-w-0 text-graphite">{ev.value}</span>
                          <span className="sr-only">{ev.state === "holds" ? "(passes)" : ev.state === "blocks" ? "(fails)" : "(open)"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">
                  {item.canPayNow ? (
                    <Button onClick={() => { setActionError(null); setPayNowItem(item); }}>Approve and pay</Button>
                  ) : null}
                  {item.canSign ? (
                    <Button variant="secondary" onClick={() => { setActionError(null); setSignItem(item); }}>Sign approval</Button>
                  ) : null}
                  {item.canReject ? (
                    <Button variant="secondary" onClick={() => { setActionError(null); setRejectionReason(""); setRejectItem(item); }}>Reject</Button>
                  ) : null}
                  {!item.canPayNow && !item.canSign && !item.canReject ? (
                    <p className="text-sm text-graphite">Your role or connected wallet can’t approve or pay this invoice.</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Recent responses */}
      {data.recentAnswers.length > 0 ? (
        <section aria-labelledby="recent-title" className="space-y-4 border-t border-rule pt-8">
          <SectionTitle id="recent-title">Recent responses</SectionTitle>
          <ul className="divide-y divide-rule-soft rounded-doc border border-rule bg-paper-raised">
            {data.recentAnswers.map((ans) => (
              <li key={ans.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill tone={ans.kind === "approval_granted" ? "ok" : "danger"}>
                      {ans.kind === "approval_granted" ? "Approved" : "Rejected"}
                    </StatusPill>
                    <span className="text-graphite">{formatDay(new Date(ans.createdAt))}</span>
                  </div>
                  {ans.reason ? <p className="mt-1.5 text-graphite">Reason: {ans.reason}</p> : null}
                </div>
                <Link href={`/business/decisions/${ans.id}`} className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
                  Decision record →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Approve and pay */}
      {payNowItem ? (
        <Overlay title="Approve and pay" description="Your wallet sends this payment to the vendor from the Vault. It clears on Arc within moments." onClose={() => setPayNowItem(null)}>
          <DetailList
            items={[
              { label: "Vendor", value: payNowItem.vendor.name },
              { label: "Invoice", value: payNowItem.invoiceNumber },
              { label: "Amount", value: <Money>{showMoney(payNowItem.amountFormatted, payNowItem.token)}</Money> },
              { label: "Paid by", value: data.userWallet ? <Address value={data.userWallet} full /> : "Your connected wallet" },
            ]}
          />

          {actionError ? <InlineError>{actionError}</InlineError> : null}

          <Overlay.Footer>
            <Button variant="secondary" onClick={() => setPayNowItem(null)} disabled={actionLoading}>Cancel</Button>
            <Button onClick={() => handlePayNow(payNowItem)} busy={actionLoading}>{actionLoading ? "Sending…" : "Confirm and pay"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}

      {/* Sign an approval */}
      {signItem ? (
        <Overlay
          title="Sign the approval"
          description="You sign a message, not a transaction: no fee. The Steward attaches your signature and makes the payment on its next run."
          onClose={() => setSignItem(null)}
        >
          <DetailList
            items={[
              { label: "Vendor", value: signItem.vendor.name },
              { label: "Amount to settle", value: <Money>{showMoney(signItem.amountFormatted, signItem.token)}</Money> },
              { label: "Good for", value: "24 hours from signing" },
              { label: "Signed by", value: data.userWallet ? <Address value={data.userWallet} full /> : "Your connected wallet" },
            ]}
          />

          {actionError ? <InlineError>{actionError}</InlineError> : null}

          <Overlay.Footer>
            <Button variant="secondary" onClick={() => setSignItem(null)} disabled={actionLoading}>Cancel</Button>
            <Button onClick={() => handleSignApproval(signItem)} busy={actionLoading}>{actionLoading ? "Signing…" : "Sign approval"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}

      {/* Reject */}
      {rejectItem ? (
        <Overlay
          title="Reject this invoice"
          description="The invoice goes on hold. The Steward won't look at it or pay it until an owner releases the hold."
          onClose={() => setRejectItem(null)}
        >
          <Field label="Reason" hint="Required: 3 to 500 characters. It is kept in the decision record.">
            {(a) => (
              <textarea
                {...a}
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Why this invoice is being rejected"
                className={textareaClass}
              />
            )}
          </Field>

          {actionError ? <InlineError>{actionError}</InlineError> : null}

          <Overlay.Footer>
            <Button variant="secondary" onClick={() => setRejectItem(null)} disabled={actionLoading}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleReject(rejectItem)} busy={actionLoading}>{actionLoading ? "Rejecting…" : "Reject invoice"}</Button>
          </Overlay.Footer>
        </Overlay>
      ) : null}
    </div>
  );
}
