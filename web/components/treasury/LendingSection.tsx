"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";

import { Address } from "@/components/Address";
import { Overlay } from "@/components/Overlay";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { DetailList } from "@/components/ui/DetailList";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError, EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { SectionTitle } from "@/components/ui/Type";
import { SentTransactionNotice, useSentTransaction } from "@/components/wallet/useSentTransaction";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson, postRecord } from "@/lib/client/api";
import { recordQueuedChange } from "@/lib/client/queued-actions";
import { formatDateTime, showMoney } from "@/lib/format";
import type { LendingView } from "@/lib/server/lending";

// The lending reserve (plan 05zk): one lending vault the owner chose, opt-in and capped. It is a lending-risk tier, never
// "safe yield": the value can fall and a withdrawal depends on the vault's liquidity. The screen says so and shows only
// numbers read from Arc (a failed read is a failed read, never zero) and a yield only once a week of share prices exist.

const money = (raw: string) => showMoney(formatUnits(BigInt(raw), 6), "USDC");
const REFRESH_MS = 30_000;

type Dialog = "policy" | "deposit" | "redeem" | null;

export function LendingSection({ businessId, signer, explorer, isOwner }: { businessId: string; signer: SignerPlan; explorer: string; isOwner: boolean }) {
  const [view, setView] = useState<LendingView | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      const res = await fetch(`/api/business/${businessId}/treasury?part=lending`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setView(data.lending as LendingView);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [businessId]);

  useEffect(() => {
    void read();
    const id = setInterval(() => {
      if (!document.hidden) void read();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [read]);

  const title = (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <SectionTitle id="lending">Lending reserve</SectionTitle>
      {isOwner && view?.supported && view.readOk ? (
        <Button variant="secondary" size="sm" onClick={() => setDialog("policy")}>Change lending policy</Button>
      ) : null}
    </div>
  );

  if (view === null) {
    return (
      <section aria-labelledby="lending" className="mt-14 min-w-0">
        {title}
        {failed ? (
          <Callout tone="warn" className="mt-4" title="The lending reserve can’t be read right now">Reload in a moment to try again.</Callout>
        ) : (
          <p className="mt-4 text-sm text-graphite">Reading the lending reserve from Arc…</p>
        )}
      </section>
    );
  }

  if (!view.supported) {
    return (
      <section aria-labelledby="lending" className="mt-14 min-w-0">
        {title}
        <EmptyState title="Not available on this Vault" className="mt-4">
          {view.currentRelease
            ? `This Vault runs release ${view.currentRelease}; the lending reserve is in release 4. Upgrading it adds the option, and it stays off until you switch it on.`
            : "This Vault’s release doesn’t have the lending reserve. Upgrading it adds the option; it stays off until you switch it on."}{" "}
          {isOwner ? <a href="/business/settings" className="underline decoration-rule underline-offset-4 hover:text-ink">Go to Settings to upgrade</a> : null}
        </EmptyState>
      </section>
    );
  }

  const venueSet = view.policy.venue !== null;
  const hasShares = BigInt(view.shares) > 0n;
  const isTest = view.venue?.kind === "test";

  return (
    <section aria-labelledby="lending" className="mt-14 min-w-0">
      {title}
      <p className="mt-2 max-w-[68ch] text-sm text-graphite">
        Cash the Vault doesn’t need soon can sit in one lending vault you choose. It is not a bank deposit: its value can fall, and
        getting cash back depends on that vault’s own liquidity. You set how much; the Vault holds the shares itself.
      </p>

      {notice ? <p role="status" className="mt-3 rounded-doc border border-seal/40 bg-seal/5 p-3 text-sm text-seal">{notice}</p> : null}
      {failed ? <p className="mt-3 text-sm text-warn">Couldn’t refresh just now; what is shown may be out of date.</p> : null}

      {!view.readOk ? (
        <Callout tone="warn" className="mt-4" title="Can’t confirm the lending reserve">Arc didn’t answer for this Vault. Nothing is shown rather than a guess; try again shortly.</Callout>
      ) : !venueSet ? (
        <EmptyState
          title="Lending is off"
          className="mt-4"
          action={isOwner && view.venues.length > 0 ? <Button size="sm" onClick={() => setDialog("policy")}>Set it up</Button> : undefined}
        >
          {view.venues.length === 0 ? "No lending vault is listed for this network yet." : "Choose a lending vault and the most of the cash that may sit in it."}
        </EmptyState>
      ) : (
        <div className="mt-4 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={view.policy.enabled ? "ok" : "neutral"}>{view.policy.enabled ? "On" : "Off"}</StatusPill>
            {isTest ? <StatusPill tone="warn">Test vault</StatusPill> : null}
          </div>
          {isTest ? (
            <p className="text-sm text-graphite">Test vault: it shows how lending works on this test network. It is not a return you can rely on.</p>
          ) : null}

          <div>
            <p className="font-display text-5xl leading-none">
              {view.yield ? `${(view.yield.bps / 100).toFixed(1)}%` : "No measured yield yet"}
            </p>
            <p className="mt-2 text-sm text-graphite">
              {view.yield
                ? `a year, from this vault’s own share price over ${view.yield.days} days. Not a promise; it moves.`
                : "It appears after a week of the vault’s own share prices. A published rate is never shown here."}
            </p>
          </div>

          <DetailList
            items={[
              { label: "Lending vault", value: <span>{view.venue?.name ?? "Not on our list"} <Address value={view.policy.venue!} explorer={explorer} /></span> },
              { label: "Held", value: view.lendingValue === null ? "Can’t read its value right now" : `${money(view.lendingValue)} (${hasShares ? "shares held by the Vault" : "nothing yet"})` },
              { label: "Most allowed", value: `${view.policy.maxLendingBps / 100}% of the Vault’s cash` },
              { label: "Operating floor", value: `Never below ${money(view.minOperating)}` },
            ]}
          />

          {hasShares && view.exit ? (
            view.exit.ok ? (
              <p className="text-sm font-medium text-ok">Exit check: the vault would pay out {money(view.exit.assets)} now (simulated just now; not a promise).</p>
            ) : (
              <Callout tone="warn" title="The lending vault can’t pay out right now">
                <p>{view.exit.reason}. The shares stay in the Vault and are counted as unavailable, not as cash. Try again later.</p>
              </Callout>
            )
          ) : null}

          {isOwner ? (
            <div className="flex flex-wrap gap-3">
              <Button size="sm" onClick={() => setDialog("deposit")} disabled={!view.policy.enabled || view.paused}>Move cash in</Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog("redeem")} disabled={!hasShares}>Take cash out</Button>
            </div>
          ) : null}
          {view.paused ? <p className="text-sm text-graphite">Payments are paused: moving cash in is blocked; taking it out still works for the owner.</p> : null}
        </div>
      )}

      {dialog === "policy" ? (
        <LendingPolicyDialog
          businessId={businessId}
          signer={signer}
          view={view}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setNotice(message);
            void read();
          }}
        />
      ) : null}
      {dialog === "deposit" || dialog === "redeem" ? (
        <LendingMoveDialog
          kind={dialog}
          businessId={businessId}
          signer={signer}
          explorer={explorer}
          view={view}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setNotice(message);
            void read();
          }}
        />
      ) : null}
    </section>
  );
}

interface PreparedPolicy {
  to: string;
  data: string;
  state: "apply-now" | "will-queue" | "already-queued" | "ready";
  eta?: string;
}

function LendingPolicyDialog({
  businessId,
  signer,
  view,
  onClose,
  onDone,
}: {
  businessId: string;
  signer: SignerPlan;
  view: LendingView;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const [enabled, setEnabled] = useState(view.policy.enabled || view.policy.venue === null);
  const [maxPercent, setMaxPercent] = useState(view.policy.maxLendingBps ? String(view.policy.maxLendingBps / 100) : "20");
  const [venue, setVenue] = useState(view.policy.venue ?? view.venues[0]?.address ?? "");
  const [prepared, setPrepared] = useState<PreparedPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();
  const chosen = view.venues.find((v) => v.address === venue);
  const holdsShares = BigInt(view.shares) > 0n;

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const prep = await postJson<PreparedPolicy>(`/api/business/${businessId}/treasury`, { action: "prepare-lending-policy", enabled, maxPercent, venue });
      if (prep.state === "already-queued") {
        throw new Error(`This exact change is already waiting${prep.eta ? ` and can be applied from ${formatDateTime(prep.eta)}` : ""}. Apply it from Queued policy changes once the wait is over.`);
      }
      setPrepared(prep);
    } catch (e: any) {
      setErr(e.message || "Couldn’t prepare the change");
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!prepared) return;
    if (signer.kind !== "wallet") {
      setErr("Connect the owner’s wallet to sign this change.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, { to: prepared.to, data: prepared.data });
      await recordQueuedChange(businessId, txHash);
      onDone(
        prepared.state === "apply-now" || prepared.state === "ready"
          ? "Lending policy updated."
          : `Lending policy change queued. It takes effect from ${prepared.eta ? formatDateTime(prepared.eta) : "the end of the wait"}.`,
      );
    } catch (e: any) {
      setErr(e.message || "The change wasn’t signed");
    } finally {
      setBusy(false);
    }
  }

  if (prepared) {
    const waits = prepared.state === "will-queue";
    return (
      <Overlay title="Review the change" description="This is what your wallet will be asked to sign." onClose={onClose}>
        <div className="space-y-4">
          {err ? <InlineError>{err}</InlineError> : null}
          <dl className="divide-y divide-rule rounded-doc border border-rule">
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Lending</dt><dd className="font-medium text-ink">{enabled ? "On" : "Off"}</dd></div>
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Lending vault</dt><dd className="font-medium text-ink">{chosen?.name ?? "The current one"}</dd></div>
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Most that may sit in it</dt><dd className="font-medium text-ink">{maxPercent}% of cash</dd></div>
          </dl>
          <p className="text-graphite">
            {waits
              ? `This loosens a limit, so the Vault holds it for its waiting period first${prepared.eta ? `: it can be applied from ${formatDateTime(prepared.eta)}` : ""}. You sign twice: now to queue it, and again once the wait is over. You can cancel it while it waits.`
              : prepared.state === "ready"
                ? "The wait for this change is over. Signing applies it now."
                : "This tightens a limit, so it applies as soon as you sign."}
          </p>
          <Overlay.Footer>
            <Button variant="secondary" onClick={() => setPrepared(null)} disabled={busy}>Back</Button>
            <Button onClick={sign} busy={busy}>{busy ? "Signing…" : waits ? "Sign and queue" : "Sign and apply"}</Button>
          </Overlay.Footer>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay title="Lending policy" description="Which lending vault may hold part of the Vault’s cash, and how much." onClose={onClose}>
      <form onSubmit={review} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}
        <label className="flex min-h-11 items-center gap-3 rounded-doc border border-rule px-4">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />
          <span className="font-medium text-ink">Let part of the cash sit in a lending vault</span>
        </label>

        <Field label="Lending vault" hint={holdsShares ? "The vault can’t be changed while the Vault holds its shares: take the cash out first." : "From the list for this network. It waits the Vault’s loosening delay."}>
          {(a) => (
            <select {...a} value={venue} onChange={(e) => setVenue(e.target.value)} className={controlClass} disabled={holdsShares}>
              {view.venues.map((v) => (
                <option key={v.address} value={v.address}>{v.name}{v.kind === "test" ? " (test vault)" : ""}</option>
              ))}
            </select>
          )}
        </Field>
        {chosen?.kind === "test" ? <p className="text-sm text-graphite">This is a test vault: it shows how lending works here, not a return.</p> : null}

        <Field label="Most that may sit in it (% of cash)" hint="Up to 50%. Raising it waits the loosening delay; lowering it applies at once.">
          {(a) => <input {...a} type="text" inputMode="decimal" required value={maxPercent} onChange={(e) => setMaxPercent(e.target.value)} className={controlClass} />}
        </Field>

        <p className="text-sm text-graphite">
          Risks: the vault’s value can fall, and taking cash out depends on its liquidity and on its curator’s settings. Nothing in the
          Vault can make it pay. Your cap limits how much is exposed.
        </p>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Checking…" : "Review the change"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

function LendingMoveDialog({
  kind,
  businessId,
  signer,
  explorer,
  view,
  onClose,
  onDone,
}: {
  kind: "deposit" | "redeem";
  businessId: string;
  signer: SignerPlan;
  explorer: string;
  view: LendingView;
  onClose: () => void;
  onDone: (notice: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();
  const tx = useSentTransaction();
  const deposit = kind === "deposit";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      setErr("Connect the owner’s wallet to sign this.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const prep = await postJson<{ to: string; data: string }>(
        `/api/business/${businessId}/treasury`,
        deposit ? { action: "prepare-lending-deposit", assets: amount } : { action: "prepare-lending-redeem", assets: amount, all },
      );
      const providers = await getProviders();
      await tx.run({
        send: () => sendWithWallet(providers, signer, { to: prep.to, data: prep.data }),
        record: (hash) => postRecord(`/api/business/${businessId}/treasury`, { action: "record-reserve", txHash: hash }),
        onDone: () => onDone(deposit ? "Cash moved into the lending vault." : "Cash taken out of the lending vault."),
      });
    } catch (e: any) {
      setErr(e.message || "That didn’t go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay
      title={deposit ? "Move cash into the lending vault" : "Take cash out of the lending vault"}
      description={deposit ? "The Vault deposits USDC and holds the shares itself." : "The Vault redeems its shares back to USDC."}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}
        <p className="text-sm text-graphite">
          {deposit ? `The Vault holds ${money(view.cash)} in cash.` : view.lendingValue !== null ? `The lending vault holds ${money(view.lendingValue)} for this Vault.` : ""}
        </p>
        {!deposit ? (
          <label className="flex min-h-11 items-center gap-3 rounded-doc border border-rule px-4">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />
            <span className="font-medium text-ink">Take everything out</span>
          </label>
        ) : null}
        {!all || deposit ? (
          <Field label="USDC">
            {(a) => <input {...a} type="text" inputMode="decimal" required placeholder="1000" value={amount} onChange={(e) => setAmount(e.target.value)} className={controlClass} />}
          </Field>
        ) : null}
        <SentTransactionNotice tx={tx} explorer={explorer} />
        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>{tx.locked ? "Close" : "Cancel"}</Button>
          <Button type="submit" busy={busy || tx.busy} disabled={tx.locked}>{busy || tx.busy ? "Working…" : deposit ? "Move cash in" : "Take cash out"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}
