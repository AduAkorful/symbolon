"use client";

import { useState } from "react";
import type { SignerPlan } from "@/components/setup/owner-signer";
import { BufferModal, ConvertModal, EarlyPayModal, FundModal, RedeemModal, ReservePolicyModal, SubscribeModal, WithdrawModal } from "./TreasuryDialogs";
import { ForecastChart, type ForecastEvent, type ForecastDate } from "./ForecastChart";
import { QueuedChangeList } from "@/components/QueuedChange";
import type { TreasuryState } from "@/lib/server/treasury";
import { Address } from "@/components/Address";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { DetailList } from "@/components/ui/DetailList";
import { Money } from "@/components/ui/Money";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { PageTitle, SectionTitle, SmallTitle } from "@/components/ui/Type";
import { formatDay, showMoney } from "@/lib/format";

interface TreasuryViewProps {
  businessId: string;
  initialState: TreasuryState;
  signer: SignerPlan;
  explorer?: string;
  isOwner: boolean;
}

// Amounts arrive as exact decimal strings and are printed as they are, never turned into floating point (plan 05zb S7)
const usd = (v: string) => showMoney(v, "USDC");
const eur = (v: string) => showMoney(v, "EURC");
const textLink = "text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink";

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
    <div className="pb-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Treasury</PageTitle>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-graphite">
            <span>Vault</span>
            <Address value={state.vault} explorer={explorer} copy className="text-ink" />
            <span>· live from Arc</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="quiet" size="sm" busy={loading} onClick={refresh}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          {isOwner ? (
            <>
              <Button variant="secondary" onClick={() => setActiveModal("fund")}>Add funds</Button>
              <Button onClick={() => setActiveModal("withdraw")}>Withdraw</Button>
            </>
          ) : null}
        </div>
      </div>

      {notice ? <Callout tone="info" onDismiss={() => setNotice(null)} className="mt-6">{notice}</Callout> : null}
      {error ? <Callout tone="danger" onDismiss={() => setError(null)} className="mt-6">{error}</Callout> : null}

      {/* Summary */}
      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-rule py-6 lg:grid-cols-4">
        <div>
          <dt className="text-sm text-graphite">Operating</dt>
          <dd className="mt-1 font-display text-3xl leading-none"><Money>{state.balances.usdc ? usd(state.balances.usdc.amount) : "—"}</Money></dd>
          <dd className="mt-1.5 text-sm text-graphite">USDC in the Vault</dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Euro balance</dt>
          <dd className="mt-1 font-display text-3xl leading-none"><Money>{state.balances.eurc ? eur(state.balances.eurc.amount) : "—"}</Money></dd>
          <dd className="mt-1.5 text-sm text-graphite">EURC in the Vault</dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Reserve</dt>
          <dd className="mt-1 font-display text-3xl leading-none">
            {!state.reserve.readAvailable ? "Unavailable" : state.reserve.available ? <Money>{usd(state.reserve.reserveValue)}</Money> : "None"}
          </dd>
          <dd className="mt-1.5 text-sm text-graphite">
            {!state.reserve.readAvailable ? "The reserve couldn’t be read" : state.reserve.available ? (state.operatingSplit ? `${state.operatingSplit.reserveBps / 100}% held in USYC` : "Split unavailable") : "No reserve set up"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-graphite">Runway</dt>
          <dd className="mt-1 font-display text-3xl leading-none">
            {!state.availability.usdc || !state.availability.eurc ? "Unavailable" : state.shortfalls.length ? "Shortfall" : `${state.forecast.bufferDays} days`}
          </dd>
          <dd className="mt-1.5 text-sm text-graphite">{state.forecast.runwayStatement}</dd>
        </div>
      </dl>

      {/* Shortfalls */}
      {eurcShortfall ? (
        <Callout
          tone="danger"
          title="Euro shortfall"
          className="mt-8"
          actions={isOwner ? <Button onClick={() => setActiveModal("convert")}>Convert dollars to euros</Button> : undefined}
        >
          <p>EURC bills total {eur(eurcShortfall.due)}; the Vault is {eur(eurcShortfall.short)} short.</p>
          <p className="mt-1 text-graphite">The Vault never converts on its own. Convert USDC to EURC in your browser before the bills come due.</p>
        </Callout>
      ) : null}

      {usdcShortfall ? (
        <Callout
          tone="danger"
          title="Dollar shortfall"
          className="mt-4"
          actions={
            isOwner ? (
              <>
                <Button onClick={() => setActiveModal("fund")}>Add funds</Button>
                {state.reserve.available && parseFloat(state.reserve.shares) > 0 ? (
                  <Button variant="secondary" onClick={() => setActiveModal("redeem")}>Redeem from the reserve</Button>
                ) : null}
              </>
            ) : undefined
          }
        >
          <p>Upcoming bills are {usd(usdcShortfall.short)} more than the Vault’s operating USDC.</p>
          <p className="mt-1 text-graphite">Add funds from your wallet, or redeem from the USYC reserve if you have one.</p>
        </Callout>
      ) : null}

      {/* Forecast, budgets and obligations */}
      <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section aria-labelledby="ahead" className="min-w-0">
          <SectionTitle id="ahead">The next five weeks</SectionTitle>
          <p className="mt-1 text-sm text-graphite">Based on invoices you’ve received. It doesn’t include money you expect to receive.</p>
          <ForecastChart start={operatingUsdc / 1000} days={35} buffer={20} events={chartEvents} dates={chartDates} tableRows={state.forecast.days} />
        </section>

        <section aria-labelledby="budgets" className="min-w-0 space-y-8">
          <div>
            <SectionTitle id="budgets">Budgets</SectionTitle>
            <p className="mt-1 text-sm text-graphite">Limits on spending from the one balance, not separate pots of money.</p>
            {state.budget ? (
              <div className="mt-5 rounded-doc border border-rule px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">Operating budget</span>
                  <span className="text-graphite">
                    {state.budget.cap === null
                      ? `${usd(state.budget.spent)} spent, no cap · ${state.budget.periodLengthDays} days`
                      : `${usd(state.budget.spent)} of ${usd(state.budget.cap)} · ${state.budget.periodLengthDays} days`}
                  </span>
                </div>
                {state.budget.cap !== null && parseFloat(state.budget.cap) > 0 ? (
                  <div
                    className="mt-3 h-2 w-full overflow-hidden rounded-full bg-rule-soft"
                    role="img"
                    aria-label={`${Math.round((parseFloat(state.budget.spent) / parseFloat(state.budget.cap)) * 100)}% used`}
                  >
                    <div className="h-full bg-ink" style={{ width: `${Math.min(100, Math.round((parseFloat(state.budget.spent) / parseFloat(state.budget.cap)) * 100))}%` }} />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState title="No budgets set" className="mt-5">Set a spending limit under Policy and its progress shows here.</EmptyState>
            )}
          </div>

          <div>
            <SmallTitle>Coming obligations</SmallTitle>
            <DetailList
              className="mt-3"
              items={[
                { label: "Open purchase orders", value: `${state.comingObligations.openPurchaseOrdersCount} open · ${usd(state.comingObligations.openPurchaseOrdersTotal)}` },
                { label: "Unreleased recurring invoices", value: `${state.comingObligations.unreleasedSeriesCount} · ${usd(state.comingObligations.unreleasedSeriesTotal)}` },
              ]}
            />
          </div>
        </section>
      </div>

      {/* Reserve, and Early Pay with withdrawals */}
      <div className="mt-14 grid gap-12 xl:grid-cols-2">
        <section aria-labelledby="reserve" className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <SectionTitle id="reserve">Reserve</SectionTitle>
            {isOwner && state.reserve.available ? (
              <Button variant="secondary" size="sm" onClick={() => setActiveModal("policy")}>Change reserve policy</Button>
            ) : null}
          </div>

          {!state.reserve.readAvailable ? (
            <Callout tone="warn" className="mt-4" title="The reserve can’t be read right now">Reload in a moment to try again.</Callout>
          ) : !state.reserve.available ? (
            <EmptyState title="No reserve support" className="mt-4">This Vault’s release doesn’t support the USYC reserve. Upgrading it adds the option.</EmptyState>
          ) : !state.reserve.entitled ? (
            <Callout tone="neutral" className="mt-4" title="Circle hasn’t allowlisted this Vault for USYC yet">
              <p>USYC is for businesses that aren’t U.S. Persons under Regulation S and have onboarded with Circle. Circle allowlists the Vault’s address:</p>
              <div className="mt-3"><Address value={state.vault} full copy /></div>
            </Callout>
          ) : (
            <div className="mt-4 space-y-5">
              <p className="text-sm font-medium text-ok">Circle allows this Vault to hold USYC (checked just now)</p>
              {state.reserve.yieldBps !== null ? (
                <div>
                  <p className="font-display text-5xl leading-none">{(state.reserve.yieldBps / 100).toFixed(1)}%</p>
                  <p className="mt-2 text-sm text-graphite">a year, from the USYC price’s last 30 daily rounds. Not a promise; it moves.</p>
                </div>
              ) : (
                <p className="text-sm text-graphite">Reading the USYC price history…</p>
              )}

              <DetailList
                items={[
                  { label: "Held", value: `${usd(state.reserve.reserveValue)} (${state.reserve.shares} USYC) · ${(state.operatingSplit?.reserveBps ?? 0) / 100}% of cash` },
                  { label: "Most allowed", value: `${state.reserve.policy.maxReserveBps / 100}% of total cash` },
                  { label: "Operating floor", value: `Never below ${usd(state.reserve.policy.minOperating)}` },
                  ...(state.reserve.limitRemaining ? [{ label: "Daily subscription limit", value: `${usd(state.reserve.limitRemaining)} left today` }] : []),
                ]}
              />

              {state.pendingSweepProposal ? (
                <Callout
                  tone="info"
                  title="The Steward proposes a move"
                  actions={
                    isOwner ? (
                      <Button size="sm" onClick={() => setActiveModal(state.pendingSweepProposal?.action === "subscribe" ? "subscribe" : "redeem")}>
                        {state.pendingSweepProposal.action === "subscribe" ? "Move cash into USYC" : "Redeem USYC to cash"}
                      </Button>
                    ) : undefined
                  }
                >
                  {state.pendingSweepProposal.reason}
                </Callout>
              ) : null}

              {isOwner ? (
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => setActiveModal("subscribe")}>Move cash into USYC</Button>
                  <Button variant="secondary" onClick={() => setActiveModal("redeem")}>Redeem to cash</Button>
                </div>
              ) : null}
            </div>
          )}

          <div className="mt-10">
            <SmallTitle>Policy changes waiting</SmallTitle>
            <p className="mt-1 text-sm text-graphite">Changes that loosen a limit wait out the Vault’s delay before they can be applied.</p>
            <div className="mt-3">
              <QueuedChangeList businessId={businessId} signer={signer} explorer={explorer} onRefresh={refresh} />
            </div>
          </div>
        </section>

        <section aria-labelledby="earlypay" className="min-w-0 space-y-10">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <SectionTitle id="earlypay">Early Pay</SectionTitle>
              {isOwner ? <Button variant="secondary" size="sm" onClick={() => setActiveModal("earlyPay")}>Change settings</Button> : null}
            </div>
            <p className="mt-2 text-sm text-graphite">The Steward takes a vendor’s discount only if it beats the reserve by your margin, and keeps early payments under your cap.</p>

            <DetailList
              className="mt-5"
              items={[
                { label: "Status", value: <StatusPill tone={state.earlyPay?.enabled ? "ok" : "neutral"}>{state.earlyPay?.enabled ? "On" : "Off"}</StatusPill> },
                { label: "Must beat the reserve by", value: `${(state.earlyPay?.minSpreadBps ?? 300) / 100} points` },
                { label: "Most committed at once", value: `${(state.earlyPay?.cashCapBps ?? 3000) / 100}% of operating cash` },
                {
                  label: "Cash buffer",
                  value: (
                    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-4">
                      <span>{state.forecast.bufferDays} days of bills</span>
                      {isOwner ? <button type="button" onClick={() => setActiveModal("buffer")} className={textLink}>Change</button> : null}
                    </span>
                  ),
                },
              ]}
            />
          </div>

          <div>
            <SmallTitle>Withdraw to your wallet</SmallTitle>
            <p className="mt-1 text-sm text-graphite">Only the owner can withdraw, and only to the connected wallet. A withdrawal skips automatic matching and is recorded with the reason you give.</p>
            {isOwner ? <Button variant="secondary" className="mt-4" onClick={() => setActiveModal("withdraw")}>Withdraw funds</Button> : null}
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

      {/* 7. Reserve policy */}
      {activeModal === "policy" && (
        <ReservePolicyModal
          businessId={businessId}
          signer={signer}
          current={{ enabled: state.reserve.policy.enabled, maxReserveBps: state.reserve.policy.maxReserveBps, minOperating: state.reserve.policy.minOperating }}
          entitled={state.reserve.entitled}
          onClose={() => setActiveModal(null)}
          onSuccess={(message) => {
            setActiveModal(null);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {/* 8. Buffer Modal */}
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
