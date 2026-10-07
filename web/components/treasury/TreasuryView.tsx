"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { formatUnits, getAddress, parseUnits, erc20Abi, type Hex } from "viem";
import { Overlay } from "@/components/Overlay";
import { TxLink } from "@/components/TxLink";
import { sendWithWallet, type SignerPlan } from "@/components/setup/owner-signer";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { postJson } from "@/lib/client/api";
import { getConversionWallet } from "@/lib/client/conversion-wallet";
import { ConversionFlow, TransferNotSubmittedError, quoteOutput, observeSwapReceipt, confirmFundingReceipt, type ConversionRecovery } from "@/lib/client/conversion-flow";
import { quoteConversion, convert } from "@symbolon/kits";
import { ForecastChart, type ForecastEvent, type ForecastDate } from "./ForecastChart";
import { QueuedChangeList } from "@/components/QueuedChange";
import type { TreasuryState } from "@/lib/server/treasury";
import { formatDay } from "@/lib/format";

interface TreasuryViewProps {
  businessId: string;
  initialState: TreasuryState;
  signer: SignerPlan;
  explorer?: string;
  isOwner: boolean;
}

const usd = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const eur = (v: string | number) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "€0.00";
  return `€${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function TreasuryView({
  businessId,
  initialState,
  signer,
  explorer = "https://explorer.testnet.arc.io",
  isOwner,
}: TreasuryViewProps) {
  const [state, setState] = useState<TreasuryState>(initialState);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [activeModal, setActiveModal] = useState<
    "withdraw" | "fund" | "convert" | "subscribe" | "redeem" | "policy" | "earlyPay" | "buffer" | null
  >(null);

  const getProviders = useWalletProviders();

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/business/${businessId}/treasury`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.state) setState(data.state);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed refreshing treasury");
    } finally {
      setLoading(false);
    }
  }

  const operatingUsdc = state.balances.usdc ? parseFloat(state.balances.usdc.amount) : 0;
  const eurcAmount = state.balances.eurc ? parseFloat(state.balances.eurc.amount) : 0;
  const reserveValue = parseFloat(state.reserve.reserveValue);

  // Shortfalls
  const eurcShortfall = state.shortfalls.find((s) => s.tokenSymbol === "EURC");
  const usdcShortfall = state.shortfalls.find((s) => s.tokenSymbol === "USDC");

  // Chart data
  const chartEvents: ForecastEvent[] = state.forecast.events.map((e) => ({
    day: e.day,
    delta: e.delta / 1000,
    label: `${e.vendor} (${e.invoiceNumber})`,
    kind: "bill",
  }));

  const chartDates: ForecastDate[] = [0, 7, 14, 21, 28, 35].map((d) => {
    const dt = new Date(Date.now() + d * 86_400_000);
    return {
      day: d,
      label: formatDay(dt),
    };
  });

  return (
    <div className="max-w-[1180px] pb-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Treasury</h1>
          <p className="mt-1 font-mono text-xs text-graphite">
            Vault <span className="font-semibold text-ink">{state.vault}</span> · Block #{state.block}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-doc border border-rule px-3 py-1.5 text-xs text-graphite hover:text-ink disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh chain data"}
          </button>
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => setActiveModal("fund")}
                className="rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-ink hover:border-ink"
              >
                Add funds
              </button>
              <button
                type="button"
                onClick={() => setActiveModal("withdraw")}
                className="rounded-doc bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink/90"
              >
                Withdraw
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-6 rounded-doc border border-seal/40 bg-seal-wash/40 px-4 py-3 text-sm flex items-center justify-between">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className="text-xs text-graphite hover:text-ink ml-3">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-doc border border-red/40 bg-red-wash/40 px-4 py-3 text-sm text-red flex items-center justify-between">
          <p>{error}</p>
          <button type="button" onClick={() => setError(null)} className="text-xs text-graphite hover:text-ink ml-3">
            Dismiss
          </button>
        </div>
      )}

      {/* Summary stats */}
      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-rule py-6 md:grid-cols-4">
        <div>
          <dt className="text-sm text-graphite">Operating</dt>
          <dd className="mt-1 font-display text-3xl leading-none tabular-nums">
            {state.balances.usdc ? usd(operatingUsdc) : "—"}
          </dd>
          <dd className="mt-1 text-xs text-graphite">USDC in Vault</dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Euro balance</dt>
          <dd className="mt-1 font-display text-3xl leading-none tabular-nums">
            {state.balances.eurc ? eur(eurcAmount) : "—"}
          </dd>
          <dd className="mt-1 text-xs text-graphite">EURC in Vault</dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Reserve</dt>
          <dd className="mt-1 font-display text-3xl leading-none tabular-nums">
            {!state.reserve.readAvailable ? "Unavailable" : state.reserve.available ? usd(reserveValue) : "None"}
          </dd>
          <dd className="mt-1 text-xs text-graphite">
            {!state.reserve.readAvailable ? "Reserve read failed" : state.reserve.available ? state.operatingSplit ? `${state.operatingSplit.reserveBps / 100}% in USYC` : "Allocation unavailable" : "No reserve configured"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Runway</dt>
          <dd className="mt-1 font-display text-2xl leading-tight">
            {!state.availability.usdc || !state.availability.eurc ? "Unavailable" : state.shortfalls.length ? "Cash shortfall" : `${state.forecast.bufferDays}-day buffer`}
          </dd>
          <dd className="mt-1 text-xs text-graphite">{state.forecast.runwayStatement}</dd>
        </div>
      </dl>

      {/* Shortfall Banners */}
      {eurcShortfall && (
        <section aria-labelledby="eurc-short" className="mt-8 rounded-doc border border-red/50 bg-red-wash/20 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-red font-medium">Euro shortfall</p>
          <h2 id="eurc-short" className="mt-2 text-xl font-medium">
            EURC bills total {eur(eurcShortfall.due)}. Vault balance is {eur(eurcShortfall.short)} short.
          </h2>
          <p className="mt-1 text-sm text-graphite">
            Your Vault never converts on its own. Convert USDC to EURC in your browser before the bills come due.
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={() => setActiveModal("convert")}
              className="mt-4 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
            >
              Convert dollars to euros
            </button>
          )}
        </section>
      )}

      {usdcShortfall && (
        <section aria-labelledby="usdc-short" className="mt-8 rounded-doc border border-red/50 bg-red-wash/20 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-red font-medium">USDC shortfall</p>
          <h2 id="usdc-short" className="mt-2 text-xl font-medium">
            Upcoming bills exceed operating USDC by {usd(usdcShortfall.short)}.
          </h2>
          <p className="mt-1 text-sm text-graphite">
            Add funds from your wallet, or redeem from the USYC reserve if available.
          </p>
          {isOwner && (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setActiveModal("fund")}
                className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
              >
                Add funds
              </button>
              {state.reserve.available && parseFloat(state.reserve.shares) > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveModal("redeem")}
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                >
                  Redeem from reserve
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Grid: Forecast on left, Budgets & Coming obligations on right */}
      <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="ahead">
          <h2 id="ahead" className="font-display text-3xl">
            The next five weeks
          </h2>
          <p className="mt-1 text-sm text-graphite">
            Based on invoices you’ve received. It doesn’t include money you expect to receive.
          </p>
          <ForecastChart
            start={operatingUsdc / 1000}
            days={35}
            buffer={20}
            events={chartEvents}
            dates={chartDates}
            tableRows={state.forecast.days}
          />
        </section>

        <section aria-labelledby="budgets" className="space-y-8">
          <div>
            <h2 id="budgets" className="font-display text-3xl">
              Budgets
            </h2>
            <p className="mt-1 text-sm text-graphite">Caps on spending from one balance, not separate pots</p>
            {state.budget ? (
              <div className="mt-5 rounded-doc border border-rule p-4">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Operating budget</span>
                  <span className="tabular-nums text-graphite">
                    {state.budget.cap === null
                      ? `${usd(state.budget.spent)} spent, no cap (${state.budget.periodLengthDays} days)`
                      : `${usd(state.budget.spent)} of ${usd(state.budget.cap)} (${state.budget.periodLengthDays} days)`}
                  </span>
                </div>
                {state.budget.cap !== null && parseFloat(state.budget.cap) > 0 && (
                  <div
                    className="mt-2 h-2 w-full bg-rule-soft rounded-full overflow-hidden"
                    role="img"
                    aria-label={`${Math.round(
                      (parseFloat(state.budget.spent) / parseFloat(state.budget.cap)) * 100,
                    )}% used`}
                  >
                    <div
                      className="h-full bg-ink"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((parseFloat(state.budget.spent) / parseFloat(state.budget.cap)) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-4 text-xs text-graphite">No active departmental budgets configured.</p>
            )}
          </div>

          <div>
            <h3 className="font-medium text-lg">Coming obligations</h3>
            <dl className="mt-3 divide-y divide-rule border-y border-rule text-sm">
              <div className="flex justify-between py-2.5">
                <dt className="text-graphite">Open Purchase Orders</dt>
                <dd className="font-medium tabular-nums">
                  {state.comingObligations.openPurchaseOrdersCount} open ({usd(state.comingObligations.openPurchaseOrdersTotal)})
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-graphite">Unreleased recurring series</dt>
                <dd className="font-medium tabular-nums">
                  {state.comingObligations.unreleasedSeriesCount} periods ({usd(state.comingObligations.unreleasedSeriesTotal)})
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Grid: Reserve on left, Early Pay & Withdraw on right */}
      <div className="mt-14 grid gap-12 xl:grid-cols-2">
        <section aria-labelledby="reserve">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="reserve" className="font-display text-3xl">
              Reserve
            </h2>
            {isOwner && state.reserve.available && (
              <button
                type="button"
                onClick={() => setActiveModal("policy")}
                className="text-xs text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
              >
                Change reserve policy
              </button>
            )}
          </div>

          {!state.reserve.readAvailable ? (
            <p className="text-sm text-graphite">Reserve status unavailable. Retry the chain read.</p>
          ) : !state.reserve.available ? (
            <div className="mt-4 rounded-doc border border-rule p-5">
              <p className="font-medium">No reserve support</p>
              <p className="mt-2 text-sm text-graphite">
                This Vault implementation does not support the USYC reserve. An upgrade is required to enable USYC features.
              </p>
            </div>
          ) : !state.reserve.entitled ? (
            <div className="mt-4 rounded-doc border border-rule p-5">
              <p className="font-medium">Circle has not allowlisted this Vault for USYC</p>
              <p className="mt-2 text-sm text-graphite">
                USYC is for businesses that are not U.S. Persons under Regulation S and have onboarded with Circle.
                Your Vault’s address is <span className="font-mono text-ink select-all">{state.vault}</span>; Circle allowlists it.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-seal font-medium">✓ Circle allows this Vault to hold USYC (checked live)</p>
              {state.reserve.yieldBps !== null ? (
                <div>
                  <p className="font-display text-5xl leading-none">{(state.reserve.yieldBps / 100).toFixed(1)}%</p>
                  <p className="mt-1 text-sm text-graphite">
                    a year, from the USYC price’s last 30 daily rounds. Not a promise; it moves.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-graphite">Reading oracle price history…</p>
              )}

              <dl className="mt-5 border-t border-ink text-sm">
                <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule py-2.5">
                  <dt className="text-graphite">Held</dt>
                  <dd>
                    {usd(state.reserve.reserveValue)} ({state.reserve.shares} USYC) · {(state.operatingSplit?.reserveBps ?? 0) / 100}% of dollars
                  </dd>
                </div>
                <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule py-2.5">
                  <dt className="text-graphite">Most allowed</dt>
                  <dd>{state.reserve.policy.maxReserveBps / 100}% of total cash</dd>
                </div>
                <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule py-2.5">
                  <dt className="text-graphite">Operating floor</dt>
                  <dd>Never below {usd(state.reserve.policy.minOperating)}</dd>
                </div>
                {state.reserve.limitRemaining && (
                  <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule py-2.5">
                    <dt className="text-graphite">Daily subscription limit</dt>
                    <dd>{usd(state.reserve.limitRemaining)} remaining today</dd>
                  </div>
                )}
              </dl>

              {/* Steward proposed sweep/redeem notice */}
              {state.pendingSweepProposal && (
                <div className="rounded-doc border border-seal/50 bg-seal-wash/30 p-4">
                  <p className="font-medium text-sm">Steward adjustment proposal</p>
                  <p className="text-xs text-graphite mt-1">{state.pendingSweepProposal.reason}</p>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() =>
                        state.pendingSweepProposal?.action === "subscribe"
                          ? setActiveModal("subscribe")
                          : setActiveModal("redeem")
                      }
                      className="mt-3 rounded-doc bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink/90"
                    >
                      Do it now ({state.pendingSweepProposal.action})
                    </button>
                  )}
                </div>
              )}

              {isOwner && (
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveModal("subscribe")}
                    className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90"
                  >
                    Subscribe to USYC
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModal("redeem")}
                    className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                  >
                    Redeem to cash
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Queued changes for reserve policy if any */}
          <div className="mt-8">
            <h3 className="font-medium text-sm text-graphite uppercase tracking-wider">Queued policy changes</h3>
            <QueuedChangeList businessId={businessId} signer={signer} explorer={explorer} onRefresh={refresh} />
          </div>
        </section>

        <section aria-labelledby="earlypay" className="space-y-8">
          <div>
            <div className="flex items-baseline justify-between">
              <h2 id="earlypay" className="font-display text-3xl">
                Early Pay program
              </h2>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setActiveModal("earlyPay")}
                  className="text-xs text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  Edit settings
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-graphite">
              The Steward takes a vendor’s discount only if it beats the reserve by your margin, and keeps early payments under your cap.
            </p>

            <dl className="mt-5 border-t border-ink text-sm">
              <div className="grid grid-cols-[12rem_1fr] gap-3 border-b border-rule py-2.5">
                <dt className="text-graphite">Program status</dt>
                <dd className="font-medium">{state.earlyPay?.enabled ? "Active" : "Disabled"}</dd>
              </div>
              <div className="grid grid-cols-[12rem_1fr] gap-3 border-b border-rule py-2.5">
                <dt className="text-graphite">Must beat reserve by</dt>
                <dd>{(state.earlyPay?.minSpreadBps ?? 300) / 100} points</dd>
              </div>
              <div className="grid grid-cols-[12rem_1fr] gap-3 border-b border-rule py-2.5">
                <dt className="text-graphite">Most committed at once</dt>
                <dd>{(state.earlyPay?.cashCapBps ?? 3000) / 100}% of operating cash</dd>
              </div>
              <div className="grid grid-cols-[12rem_1fr] gap-3 border-b border-rule py-2.5">
                <dt className="text-graphite">Buffer horizon</dt>
                <dd className="flex items-center justify-between">
                  <span>{state.forecast.bufferDays} days of bills</span>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => setActiveModal("buffer")}
                      className="text-xs text-graphite hover:text-ink underline"
                    >
                      Change
                    </button>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="font-medium text-lg">Withdraw to owner wallet</h3>
            <p className="mt-1 text-sm text-graphite">
              Only the owner can withdraw. Destination is always your connected wallet. This bypasses automated matching and is recorded with your stated reason.
            </p>
            {isOwner && (
              <button
                type="button"
                onClick={() => setActiveModal("withdraw")}
                className="mt-3 rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
              >
                Withdraw funds
              </button>
            )}
          </div>
        </section>
      </div>

      {/* MODALS */}

      {/* 1. Withdraw Modal */}
      {activeModal === "withdraw" && (
        <WithdrawModal
          businessId={businessId}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={(txHash) => {
            setActiveModal(null);
            setNotice(`Withdrawal complete. Transaction: ${txHash}`);
            refresh();
          }}
        />
      )}

      {/* 2. Fund Modal */}
      {activeModal === "fund" && (
        <FundModal
          businessId={businessId}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            setNotice("Funds transferred to Vault.");
            refresh();
          }}
        />
      )}

      {/* 3. Convert Modal */}
      {activeModal === "convert" && (
        <ConvertModal
          businessId={businessId}
          vault={state.vault}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={(txHash) => {
            setActiveModal(null);
            setNotice(`Conversion complete. EURC transferred to Vault. Transaction: ${txHash}`);
            refresh();
          }}
        />
      )}

      {/* 4. Subscribe Modal */}
      {activeModal === "subscribe" && (
        <SubscribeModal
          businessId={businessId}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={(txHash) => {
            setActiveModal(null);
            setNotice(`USYC subscription complete. Transaction: ${txHash}`);
            refresh();
          }}
        />
      )}

      {/* 5. Redeem Modal */}
      {activeModal === "redeem" && (
        <RedeemModal
          businessId={businessId}
          signer={signer}
          onClose={() => setActiveModal(null)}
          onSuccess={(txHash) => {
            setActiveModal(null);
            setNotice(`USYC redemption complete. Transaction: ${txHash}`);
            refresh();
          }}
        />
      )}

      {/* 6. Early Pay Modal */}
      {activeModal === "earlyPay" && (
        <EarlyPayModal
          businessId={businessId}
          current={state.earlyPay}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            setNotice("Early Pay settings updated.");
            refresh();
          }}
        />
      )}

      {/* 7. Buffer Modal */}
      {activeModal === "buffer" && (
        <BufferModal
          businessId={businessId}
          currentDays={state.forecast.bufferDays}
          onClose={() => setActiveModal(null)}
          onSuccess={() => {
            setActiveModal(null);
            setNotice("Buffer horizon updated.");
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// MODAL COMPONENTS
// ---------------------------------------------------------------------------------------------------------------------

function WithdrawModal({
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
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
        destination: string;
      }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-withdraw",
        tokenSymbol,
        amount,
      });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      await postJson(`/api/business/${businessId}/treasury`, {
        action: "record-withdraw",
        txHash,
        reason,
      });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Withdraw funds" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Withdraw to your wallet</h2>
        <p className="mt-1 text-xs text-graphite">
          Funds are withdrawn directly to your address: <span className="font-mono text-ink">{signer.kind === "wallet" ? signer.address : "No wallet"}</span>
        </p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-graphite">Token</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTokenSymbol("USDC")}
                className={`flex-1 py-1.5 rounded-doc border text-xs font-medium ${
                  tokenSymbol === "USDC" ? "border-ink bg-ink text-paper" : "border-rule text-ink"
                }`}
              >
                USDC
              </button>
              <button
                type="button"
                onClick={() => setTokenSymbol("EURC")}
                className={`flex-1 py-1.5 rounded-doc border text-xs font-medium ${
                  tokenSymbol === "EURC" ? "border-ink bg-ink text-paper" : "border-rule text-ink"
                }`}
              >
                EURC
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-graphite">Amount</label>
            <input
              type="text"
              required
              placeholder="e.g. 100.50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-graphite">Why (recorded in decisions)</label>
            <input
              type="text"
              required
              placeholder="e.g. Manual payment checked by phone"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Signing…" : "Sign & withdraw"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function FundModal({
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
      const prep = await postJson<{
        ok: boolean;
        to: string;
        data: string;
      }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-fund",
        tokenSymbol,
        amount,
      });

      const providers = await getProviders();
      await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Funding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Add funds" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Add funds to Vault</h2>
        <p className="mt-1 text-xs text-graphite">Transfer tokens from your connected wallet to the Vault.</p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-graphite">Token</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTokenSymbol("USDC")}
                className={`flex-1 py-1.5 rounded-doc border text-xs font-medium ${
                  tokenSymbol === "USDC" ? "border-ink bg-ink text-paper" : "border-rule text-ink"
                }`}
              >
                USDC
              </button>
              <button
                type="button"
                onClick={() => setTokenSymbol("EURC")}
                className={`flex-1 py-1.5 rounded-doc border text-xs font-medium ${
                  tokenSymbol === "EURC" ? "border-ink bg-ink text-paper" : "border-rule text-ink"
                }`}
              >
                EURC
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-graphite">Amount</label>
            <input
              type="text"
              required
              placeholder="e.g. 500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Transferring…" : "Transfer to Vault"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function ConvertModal({
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
  const [recovery, setRecovery] = useState<ConversionRecovery>({swapStarted:false,swapHash:null,amountRaw:null,transferHash:null});
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
  async function observeGain(hash:string,onReceipt:(hash:string)=>void) {
    const {client,deployment,owner}=await walletContext();
    return observeSwapReceipt(client,deployment.tokens.eurc,owner,hash,onReceipt);
  }
  async function getQuote() {
    setBusy(true); setErr(null);
    try {
      if (!/^\d+(\.\d{1,6})?$/.test(amountUsdc)) throw new Error("Use at most six decimal places.");
      const {kit,client,deployment,owner}=await walletContext();
      const amount=parseUnits(amountUsdc,6);
      const cash=await client.readContract({address:deployment.tokens.usdc,abi:erc20Abi,functionName:"balanceOf",args:[owner]});
      if (cash<amount) throw new Error("The owner's wallet has insufficient USDC.");
      const est=await quoteConversion(kit,{tokenIn:"USDC",tokenOut:"EURC",amountIn:amount,slippageBps:50});
      setQuote({out:quoteOutput(est),input:amountUsdc});
    } catch(e) {setErr(e instanceof Error?e.message:"Quote unavailable");} finally {setBusy(false);}
  }
  async function executeSwap() {
    setBusy(true);setErr(null);
    try {
      if (!flow.current) throw new Error("Conversion recovery is loading.");
      if (flow.current.state.swapStarted) {
        await flow.current.confirm(observeGain);
      } else {
        if (!quote || quote.input!==amountUsdc) throw new Error("Get a current quote first.");
        const {kit}=await walletContext();
        await flow.current.swap(()=>convert(kit,{tokenIn:"USDC",tokenOut:"EURC",amountIn:parseUnits(quote.input,6),slippageBps:50}),observeGain);
      }
    } catch(e) {setErr(e instanceof Error?e.message:"Conversion could not be confirmed");} finally {setBusy(false);}
  }
  async function fundGainedEurc() {
    setBusy(true);setErr(null);
    try {
      if (!flow.current || signer.kind!=="wallet") throw new Error("Connect the owner's wallet.");
      if (!flow.current.state.transferHash) await flow.current.confirm(observeGain);
      const hash = await flow.current.fund(async(amount)=>{
        let submitted = false;
        try {
          const {providers}=await walletContext();
          const prep=await postJson<{to:string;data:string}>(`/api/business/${businessId}/treasury`,{action:"prepare-fund",tokenSymbol:"EURC",amount});
          const tracked = providers.map(provider => ({ request: (args: Parameters<typeof provider.request>[0]) => {
            if (args.method === "eth_sendTransaction") submitted = true;
            return provider.request(args);
          } }));
          return await sendWithWallet(tracked,signer,prep);
        } catch (error) {
          if (!submitted) throw new TransferNotSubmittedError(error instanceof Error ? error.message : "Funding was not submitted.");
          throw error;
        }
      },async(swapTxHash,transferTxHash)=>postJson(`/api/business/${businessId}/treasury`,{action:"record-conversion",swapTxHash,transferTxHash}), async(hash,amountRaw,onReceipt) => {
        const {client,owner,deployment} = await walletContext();
        return confirmFundingReceipt(client,deployment.tokens.eurc,owner,getAddress(vault),BigInt(amountRaw),hash,onReceipt);
      });
      sessionStorage.removeItem(recoveryKey);
      onSuccess(hash);
    } catch(e) {setErr(e instanceof Error?e.message:"Vault funding failed. Retry funding without another swap.");} finally {setBusy(false);}
  }

  return (
    <Overlay label="Convert dollars to euros" onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Convert to euros</h2>
        <p className="mt-1 text-xs text-graphite">
          Swaps USDC to EURC in your browser via Circle App Kit, then adds the EURC to your Vault.
        </p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}
        {recovery.swapStarted && <p className="mt-3 text-xs text-graphite">A conversion has started. Subsequent actions confirm or fund that conversion. Another swap is blocked. {recovery.swapHash}</p>}

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-graphite">USDC to convert</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={amountUsdc}
                disabled={recovery.swapStarted}
                onChange={(e) => {setAmountUsdc(e.target.value);setQuote(null);}}
                className="flex-1 rounded-doc border border-rule px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={getQuote}
                disabled={busy || recovery.swapStarted}
                className="rounded-doc border border-rule px-3 py-2 text-xs font-medium hover:border-ink"
              >
                Quote
              </button>
            </div>
          </div>

          {quote && (
            <dl className="rounded-doc border border-rule bg-paper-raised p-3 text-xs space-y-2">
              <div className="flex justify-between">
                <dt className="text-graphite">Estimated EURC</dt>
                <dd className="font-mono font-medium">{quote.out} EURC</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-graphite">Slippage protection</dt>
                <dd className="font-mono">0.5% (50 bps)</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={recovery.amountRaw !== null ? fundGainedEurc : executeSwap}
            disabled={busy || (!quote && !recovery.swapHash) || (recovery.swapStarted && !recovery.swapHash)}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Confirming…" : recovery.transferHash ? "Confirm Vault funding" : recovery.amountRaw !== null ? `Add ${formatUnits(BigInt(recovery.amountRaw),6)} EURC to Vault` : recovery.swapHash ? "Confirm existing swap" : "Sign & convert"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function SubscribeModal({
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
      const prep = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-subscribe",
        assets,
      });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      await postJson(`/api/business/${businessId}/treasury`, {
        action: "record-reserve",
        txHash,
      });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Subscription failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Subscribe to USYC" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Move cash to USYC</h2>
        <p className="mt-1 text-xs text-graphite">Subscribes USDC from the Vault into yield-bearing USYC shares.</p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4">
          <label className="block text-xs font-medium text-graphite">USDC amount</label>
          <input
            type="text"
            required
            placeholder="e.g. 1000"
            value={assets}
            onChange={(e) => setAssets(e.target.value)}
            className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Subscribing…" : "Subscribe"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function RedeemModal({
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
      const prep = await postJson<{ to: string; data: string }>(`/api/business/${businessId}/treasury`, {
        action: "prepare-redeem",
        shares,
      });

      const providers = await getProviders();
      const txHash = await sendWithWallet(providers, signer, {
        to: prep.to,
        data: prep.data,
      });

      await postJson(`/api/business/${businessId}/treasury`, {
        action: "record-reserve",
        txHash,
      });

      onSuccess(txHash);
    } catch (e: any) {
      setErr(e.message || "Redemption failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Redeem from USYC" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Redeem USYC to cash</h2>
        <p className="mt-1 text-xs text-graphite">Redeems reserve shares back into operating USDC.</p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4">
          <label className="block text-xs font-medium text-graphite">USYC shares to redeem</label>
          <input
            type="text"
            required
            placeholder="e.g. 500"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Redeeming…" : "Redeem"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function EarlyPayModal({
  businessId,
  current,
  onClose,
  onSuccess,
}: {
  businessId: string;
  current: TreasuryState["earlyPay"];
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
      await postJson(`/api/business/${businessId}/treasury`, {
        action: "early-pay",
        settings: {
          enabled,
          minSpreadBps,
          cashCapBps,
        },
      });
      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Failed updating Early Pay");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Early Pay settings" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Early Pay settings</h2>
        <p className="mt-1 text-xs text-graphite">
          Configures when the Steward is allowed to accept early payment discounts from vendors.
        </p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4 space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-rule text-ink focus:ring-ink"
            />
            <span className="text-sm font-medium">Enable Early Pay program</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-graphite">Minimum spread over reserve (%)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={minSpreadPercent}
              onChange={(e) => setMinSpreadPercent(e.target.value)}
              className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-graphite">Max operating cash committed (%)</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={cashCapPercent}
              onChange={(e) => setCashCapPercent(e.target.value)}
              className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}

function BufferModal({
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
      await postJson(`/api/business/${businessId}/treasury`, {
        action: "buffer",
        days: parseInt(days, 10),
      });
      onSuccess();
    } catch (e: any) {
      setErr(e.message || "Failed updating buffer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay label="Operating buffer" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-rule bg-paper p-6 shadow-2xl">
        <h2 className="font-display text-2xl">Cash buffer</h2>
        <p className="mt-1 text-xs text-graphite">
          Number of days of future bills reserved in operating cash before sweeps into the reserve (1 to 90 days).
        </p>

        {err && <p className="mt-3 text-xs text-red">{err}</p>}

        <div className="mt-4">
          <label className="block text-xs font-medium text-graphite">Buffer days</label>
          <input
            type="number"
            min="1"
            max="90"
            required
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mt-1 w-full rounded-doc border border-rule px-3 py-2 text-sm font-mono"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-doc bg-ink py-2 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save buffer"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2 text-sm text-graphite hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}
