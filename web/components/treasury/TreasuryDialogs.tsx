"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, parseUnits, erc20Abi } from "viem";
import { quoteConversion, convert } from "@symbolon/kits";

import { Address } from "@/components/Address";
import { Overlay } from "@/components/Overlay";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { InlineError } from "@/components/ui/States";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { getConversionWallet } from "@/lib/client/conversion-wallet";
import { ConversionFlow, TransferNotSubmittedError, quoteOutput, observeSwapReceipt, confirmFundingReceipt, type ConversionRecovery } from "@/lib/client/conversion-flow";
import { recordQueuedChange } from "@/lib/client/queued-actions";
import { formatDateTime } from "@/lib/format";

// The treasury's dialogs (plan 05zb F3). Each is one `Overlay`: the frame, the title, the padding and the scroll belong to it;
// what is here is only the content and the buttons.

const TOKENS = [
  { value: "USDC", label: "USDC" },
  { value: "EURC", label: "EURC" },
] as const;

export function WithdrawModal({
  businessId,
  signer,
  onClose,
  onSuccess,
}: {
  businessId: string;
  signer: SignerPlan;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}) {
  const [tokenSymbol, setTokenSymbol] = useState<"USDC" | "EURC">("USDC");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      setErr("Connect an owner wallet to sign withdrawals.");
      return;
    }
    setBusy(true);
    setErr(null);

    try {
      const prep = await postJson<{ ok: boolean; to: string; data: string; destination: string }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-withdraw",
        tokenSymbol,
        amount,
      });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, { to: prep.to, data: prep.data });

      await postJson(`/api/business/${businessId}/treasury`, { action: "record-withdraw", txHash, reason });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Withdraw to your wallet" description="Funds go straight from the Vault to your own wallet. The reason is kept in the decision record." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">To</p>
          {signer.kind === "wallet" ? <Address value={signer.address} full className="text-ink" /> : <p className="text-graphite">No wallet connected</p>}
        </div>

        <Segmented label="Token" value={tokenSymbol} options={TOKENS} onChange={setTokenSymbol} />

        <Field label="Amount">
          {(a) => <input {...a} type="text" inputMode="decimal" required placeholder="100.50" value={amount} onChange={(e) => setAmount(e.target.value)} className={controlClass} />}
        </Field>

        <Field label="Reason" hint="Why this is leaving the Vault. Recorded in decisions.">
          {(a) => <input {...a} type="text" required placeholder="Manual payment checked by phone" value={reason} onChange={(e) => setReason(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Signing…" : "Sign and withdraw"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

export function FundModal({
  businessId,
  signer,
  onClose,
  onSuccess,
}: {
  businessId: string;
  signer: SignerPlan;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tokenSymbol, setTokenSymbol] = useState<"USDC" | "EURC">("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") {
      setErr("Connect a wallet to fund the Vault.");
      return;
    }
    setBusy(true);
    setErr(null);

    try {
      const prep = await postJson<{ ok: boolean; to: string; data: string }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-fund",
        tokenSymbol,
        amount,
      });

      const providers = await getProviders();
      await sendWithWallet(providers, signer, { to: prep.to, data: prep.data });

      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Funding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Add funds to the Vault" description="Sends tokens from your connected wallet to the Vault." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <Segmented label="Token" value={tokenSymbol} options={TOKENS} onChange={setTokenSymbol} />

        <Field label="Amount">
          {(a) => <input {...a} type="text" inputMode="decimal" required placeholder="500" value={amount} onChange={(e) => setAmount(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Sending…" : "Send to Vault"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

export function ConvertModal({
  businessId,
  vault,
  signer,
  onClose,
  onSuccess,
}: {
  businessId: string;
  vault: string;
  signer: SignerPlan;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}) {
  const [amountUsdc, setAmountUsdc] = useState("10");
  const [quote, setQuote] = useState<{ out: string; input: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<ConversionRecovery>({ swapStarted: false, swapHash: null, amountRaw: null, transferHash: null });
  const flow = useRef<ConversionFlow | null>(null);
  const getProviders = useWalletProviders();
  const recoveryKey = `symbolon:conversion:${businessId}:${signer.kind === "wallet" ? signer.address.toLowerCase() : "none"}`;
  useEffect(() => {
    let saved: ConversionRecovery | undefined;
    try { const raw = sessionStorage.getItem(recoveryKey); if (raw) saved = JSON.parse(raw); } catch { /* no previous operation */ }
    flow.current = new ConversionFlow(saved, (state) => { sessionStorage.setItem(recoveryKey, JSON.stringify(state)); setRecovery(state); });
    setRecovery(flow.current.state);
  }, [recoveryKey]);

  async function walletContext() { return getConversionWallet(signer, await getProviders()); }
  async function observeGain(hash: string, onReceipt: (hash: string) => void) {
    const { client, deployment, owner } = await walletContext();
    return observeSwapReceipt(client, deployment.tokens.eurc, owner, hash, onReceipt);
  }
  async function getQuote() {
    setBusy(true); setErr(null);
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) throw new Error("Use at most six decimal places.");
      const { kit, client, deployment, owner } = await walletContext();
      const amount = parseUnits(amountUsdc, 6);
      const cash = await client.readContract({ address: deployment.tokens.usdc, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
      if (cash < amount) throw new Error("The owner's wallet has insufficient USDC.");
      const est = await quoteConversion(kit, { tokenIn: "USDC", tokenOut: "EURC", amountIn: amount, slippageBps: 50 });
      setQuote({ out: quoteOutput(est), input: amountUsdc });
    } catch (e) { setErr(e instanceof Error ? e.message : "Quote unavailable"); } finally { setBusy(false); }
  }
  async function executeSwap() {
    setBusy(true); setErr(null);
    try {
      if (!flow.current) throw new Error("Conversion recovery is loading.");
      if (flow.current.state.swapStarted) {
        await flow.current.confirm(observeGain);
      } else {
        if (!quote || quote.input !== amountUsdc) throw new Error("Get a current quote first.");
        const { kit } = await walletContext();
        await flow.current.swap(() => convert(kit, { tokenIn: "USDC", tokenOut: "EURC", amountIn: parseUnits(quote.input, 6), slippageBps: 50 }), observeGain);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Conversion could not be confirmed"); } finally { setBusy(false); }
  }
  async function fundGainedEurc() {
    setBusy(true); setErr(null);
    try {
      if (!flow.current || signer.kind !== "wallet") throw new Error("Connect the owner's wallet.");
      if (!flow.current.state.transferHash) await flow.current.confirm(observeGain);
      const hash = await flow.current.fund(async (amount) => {
        let submitted = false;
        try {
          const { providers } = await walletContext();
          const prep = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/treasury`, { action: "prepare-fund", tokenSymbol: "EURC", amount });
          const tracked = providers.map((provider) => ({ request: (args: Parameters<typeof provider.request>[0]) => {
            if (args.method === "eth_sendTransaction") submitted = true;
            return provider.request(args);
          } }));
          return await sendWithWallet(tracked, signer, prep);
        } catch (error) {
          if (!submitted) throw new TransferNotSubmittedError(error instanceof Error ? error.message : "Funding was not submitted.");
          throw error;
        }
      }, async (swapTxHash, transferTxHash) => postJson(`/api/business/${businessId}/treasury`, { action: "record-conversion", swapTxHash, transferTxHash }), async (hash, amountRaw, onReceipt) => {
        const { client, owner, deployment } = await walletContext();
        return confirmFundingReceipt(client, deployment.tokens.eurc, owner, getAddress(vault), BigInt(amountRaw), hash, onReceipt);
      });
      sessionStorage.removeItem(recoveryKey);
      onSuccess(hash);
    } catch (e) { setErr(e instanceof Error ? e.message : "Vault funding failed. Retry funding without another swap."); } finally { setBusy(false); }
  }

  const primaryLabel = busy
    ? "Confirming…"
    : recovery.transferHash
      ? "Confirm Vault funding"
      : recovery.amountRaw !== null
        ? `Add ${formatUnits(BigInt(recovery.amountRaw), 6)} EURC to the Vault`
        : recovery.swapHash
          ? "Confirm the existing swap"
          : "Sign and convert";

  return (
    <Overlay title="Convert dollars to euros" description="Swaps USDC for EURC in your browser with Circle App Kit, then adds the EURC to your Vault." onClose={onClose}>
      <div className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}
        {recovery.swapStarted ? (
          <p className="break-all rounded-doc border border-rule px-3 py-2 text-graphite">
            A conversion has started. The next steps confirm or fund that conversion; another swap is blocked until it is done.
            {recovery.swapHash ? <span className="mt-1 block font-mono text-xs">{recovery.swapHash}</span> : null}
          </p>
        ) : null}

        <Field label="USDC to convert">
          {(a) => (
            <div className="flex gap-2">
              <input
                {...a}
                type="text"
                inputMode="decimal"
                value={amountUsdc}
                disabled={recovery.swapStarted}
                onChange={(e) => { setAmountUsdc(e.target.value); setQuote(null); }}
                className={controlClass}
              />
              <Button variant="secondary" onClick={getQuote} disabled={busy || recovery.swapStarted}>Get quote</Button>
            </div>
          )}
        </Field>

        {quote ? (
          <dl className="space-y-2 rounded-doc border border-rule px-4 py-3">
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Estimated EURC</dt>
              <dd className="font-medium">{quote.out} EURC</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Price protection</dt>
              <dd>0.5% at most</dd>
            </div>
          </dl>
        ) : null}

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={recovery.amountRaw !== null ? fundGainedEurc : executeSwap}
            disabled={busy || (!quote && !recovery.swapHash) || (recovery.swapStarted && !recovery.swapHash)}
          >
            {primaryLabel}
          </Button>
        </Overlay.Footer>
      </div>
    </Overlay>
  );
}

export function SubscribeModal({
  businessId,
  signer,
  onClose,
  onSuccess,
}: {
  businessId: string;
  signer: SignerPlan;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}) {
  const [assets, setAssets] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") return;
    setBusy(true);
    setErr(null);

    try {
      const prep = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/treasury`, { action: "prepare-subscribe", assets });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, { to: prep.to, data: prep.data });

      await postJson(`/api/business/${businessId}/treasury`, { action: "record-reserve", txHash });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Subscription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Move cash into USYC" description="Moves USDC from the Vault into USYC, the yield-bearing reserve." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <Field label="USDC to move">
          {(a) => <input {...a} type="text" inputMode="decimal" required placeholder="1000" value={assets} onChange={(e) => setAssets(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Moving…" : "Move to USYC"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

export function RedeemModal({
  businessId,
  signer,
  onClose,
  onSuccess,
}: {
  businessId: string;
  signer: SignerPlan;
  onClose: () => void;
  onSuccess: (txHash: string) => void;
}) {
  const [shares, setShares] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signer.kind !== "wallet") return;
    setBusy(true);
    setErr(null);

    try {
      const prep = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/treasury`, { action: "prepare-redeem", shares });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, { to: prep.to, data: prep.data });

      await postJson(`/api/business/${businessId}/treasury`, { action: "record-reserve", txHash });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Redemption failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Redeem USYC to cash" description="Turns USYC from the reserve back into USDC the Vault can pay from." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <Field label="USYC to redeem">
          {(a) => <input {...a} type="text" inputMode="decimal" required placeholder="500" value={shares} onChange={(e) => setShares(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Redeeming…" : "Redeem"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

export function EarlyPayModal({
  businessId,
  current,
  onClose,
  onSuccess,
}: {
  businessId: string;
  current: { enabled: boolean; minSpreadBps: number; cashCapBps: number } | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [minSpreadPercent, setMinSpreadPercent] = useState(((current?.minSpreadBps ?? 300) / 100).toString());
  const [cashCapPercent, setCashCapPercent] = useState(((current?.cashCapBps ?? 3000) / 100).toString());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const minSpreadBps = Math.round(parseFloat(minSpreadPercent) * 100);
    const cashCapBps = Math.round(parseFloat(cashCapPercent) * 100);

    try {
      await postJson(`/api/business/${businessId}/treasury`, { action: "early-pay", settings: { enabled, minSpreadBps, cashCapBps } });
      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Failed updating Early Pay");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Early Pay settings" description="When the Steward may accept an early-payment discount a vendor has signed." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <label className="flex min-h-11 items-center gap-3 rounded-doc border border-rule px-4">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />
          <span className="font-medium text-ink">Accept Early Pay offers</span>
        </label>

        <Field label="Smallest worthwhile discount (%)" hint="The discount has to beat what the reserve would earn by at least this much.">
          {(a) => <input {...a} type="number" inputMode="decimal" step="0.1" min="0" max="100" value={minSpreadPercent} onChange={(e) => setMinSpreadPercent(e.target.value)} className={controlClass} />}
        </Field>

        <Field label="Most operating cash to commit (%)" hint="The share of operating cash that Early Pay may tie up at one time.">
          {(a) => <input {...a} type="number" inputMode="decimal" step="1" min="0" max="100" value={cashCapPercent} onChange={(e) => setCashCapPercent(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Saving…" : "Save settings"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

export function BufferModal({
  businessId,
  currentDays,
  onClose,
  onSuccess,
}: {
  businessId: string;
  currentDays: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [days, setDays] = useState(currentDays.toString());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    try {
      await postJson(`/api/business/${businessId}/treasury`, { action: "buffer", days: parseInt(days, 10) });
      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Failed updating buffer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay title="Cash buffer" description="How many days of upcoming bills stay in operating cash before any is moved into the reserve." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <Field label="Buffer, in days" hint="From 1 to 90 days.">
          {(a) => <input {...a} type="number" inputMode="numeric" min="1" max="90" required value={days} onChange={(e) => setDays(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy}>{busy ? "Saving…" : "Save buffer"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}

interface PreparedReservePolicy {
  to: string;
  data: string;
  state: "apply-now" | "will-queue" | "already-queued" | "ready";
  loosening: boolean;
  eta?: string;
}

/**
 * Change the USYC reserve policy (plan 05zb A2). Two steps so that what is signed is what was read: the form, then a
 * statement of what the Vault will do (applies now, or waits its delay because the change loosens a limit), then the owner's
 * wallet. The receipt goes through the queued-changes record, like every other delayed change.
 */
export function ReservePolicyModal({
  businessId,
  signer,
  current,
  entitled,
  onClose,
  onSuccess,
}: {
  businessId: string;
  signer: SignerPlan;
  current: { enabled: boolean; maxReserveBps: number; minOperating: string };
  entitled: boolean;
  onClose: () => void;
  onSuccess: (notice: string) => void;
}) {
  const [enabled, setEnabled] = useState(current.enabled);
  const [maxReservePercent, setMaxReservePercent] = useState((current.maxReserveBps / 100).toString());
  const [minOperating, setMinOperating] = useState(current.minOperating);
  const [prepared, setPrepared] = useState<PreparedReservePolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const getProviders = useWalletProviders();

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const prep = await postJson<PreparedReservePolicy>(`/api/business/${businessId}/treasury`, {
        action: "prepare-reserve-policy",
        enabled,
        maxReservePercent,
        minOperating,
      });
      if (prep.state === "already-queued") throw new Error(`This exact change is already waiting${prep.eta ? ` and can be applied from ${formatDateTime(prep.eta)}` : ""}. You can apply it from Queued policy changes once the wait is over.`);
      setPrepared(prep);
    } catch (e: any) {
      setErr(e.message || "Couldn't prepare the change");
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!prepared) return;
    if (signer.kind !== "wallet") {
      setErr("Connect the owner's wallet to sign this change.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, { to: prepared.to, data: prepared.data });
      await recordQueuedChange(businessId, txHash);
      onSuccess(prepared.state === "apply-now" || prepared.state === "ready" ? "Reserve policy updated." : `Reserve policy change queued. It takes effect from ${prepared.eta ? formatDateTime(prepared.eta) : "the end of the wait"}.`);
    } catch (e: any) {
      setErr(e.message || "The change wasn't signed");
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
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Reserve</dt><dd className="font-medium text-ink">{enabled ? "On" : "Off"}</dd></div>
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Most that may sit in USYC</dt><dd className="font-medium text-ink">{maxReservePercent}% of cash</dd></div>
            <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-graphite">Always left as USDC</dt><dd className="font-medium text-ink">{minOperating} USDC</dd></div>
          </dl>
          <p className="text-graphite">
            {waits
              ? `This loosens a limit, so the Vault holds it for its waiting period first${prepared.eta ? `: it can be applied from ${formatDateTime(prepared.eta)}` : ""}. You sign twice: now to queue it, and again once the wait is over to apply it. You can cancel it while it waits.`
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
    <Overlay title="Reserve policy" description="How much of the Vault's cash may sit in USYC, and the USDC that must always stay available." onClose={onClose}>
      <form onSubmit={review} className="space-y-4">
        {err ? <InlineError>{err}</InlineError> : null}

        <label className="flex min-h-11 items-center gap-3 rounded-doc border border-rule px-4">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--seal)]" />
          <span className="font-medium text-ink">Keep part of the cash in the USYC reserve</span>
        </label>
        {enabled && !entitled ? (
          <p className="rounded-doc border border-warn/40 bg-warn-wash px-3 py-2 text-warn">Circle hasn't allowlisted this Vault for USYC yet, so the reserve can't be switched on. You can still save the limits with it off.</p>
        ) : null}

        <Field label="Most that may sit in USYC (% of cash)" hint="Raising it waits the Vault's loosening delay; lowering it applies at once.">
          {(a) => <input {...a} type="text" inputMode="decimal" required value={maxReservePercent} onChange={(e) => setMaxReservePercent(e.target.value)} className={controlClass} />}
        </Field>

        <Field label="USDC that must always stay available" hint="Lowering it waits the loosening delay; raising it applies at once. 0 is allowed.">
          {(a) => <input {...a} type="text" inputMode="decimal" required value={minOperating} onChange={(e) => setMinOperating(e.target.value)} className={controlClass} />}
        </Field>

        <Overlay.Footer>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={busy} disabled={enabled && !entitled}>{busy ? "Checking…" : "Review the change"}</Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}
