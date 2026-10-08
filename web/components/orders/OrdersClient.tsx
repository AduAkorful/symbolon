"use client";

import { useState, useTransition } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import { encodeFunctionData, type Hex } from "viem";
import { Overlay } from "@/components/Overlay";
import { Button, buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { DetailList } from "@/components/ui/DetailList";
import { Money } from "@/components/ui/Money";
import { EmptyState, InlineError } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle } from "@/components/ui/Type";
import { TxLink } from "@/components/TxLink";
import { formatDay, usd } from "@/lib/format";

// ─── Types mirrored from the server (BigInt fields as string) ────────────────

interface OrderView {
  businessId: string;
  poRef: string;
  poNumber: string;
  seal: string;
  amount: string;
  description: string | null;
  kind: string;
  releaseAfter: string | null;
  openTx: string | null;
  closedAt: string | null;
  closedTx: string | null;
  createdAt: string;
  invoicedTotal: string;
  invoiceCount: number;
  paidTotal: string;
  live: { ok: boolean; open?: boolean; remaining?: string; releaseAfter?: number };
}

type Step = "idle" | "signing" | "recording" | "done" | "error";

/** A vendor this business already knows, by the name people use for them */
export interface KnownVendor {
  seal: string;
  name: string;
}

interface OrdersProps {
  businessId: string;
  initial: OrderView[];
  vendors: KnownVendor[];
  /** The Arc explorer's address, from the deployment registry */
  explorer: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Order amounts are in the Vault's accounting unit (6 decimals): dollars */
function formatRaw(raw: string): string {
  return usd(BigInt(raw));
}

const shortSeal = (seal: string) => `${seal.slice(0, 8)}…${seal.slice(-4)}`;
const vendorName = (vendors: KnownVendor[], seal: string) => vendors.find((v) => v.seal.toLowerCase() === seal.toLowerCase())?.name ?? shortSeal(seal);

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? "Request failed");
  return json;
}

// The columns of the list on a wide screen; on a phone each order is a card with the same facts
const GRID = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_6rem_8rem_8rem_5.5rem]";

// ─── Main component ───────────────────────────────────────────────────────────

export function OrdersClient({ businessId, initial, vendors, explorer }: OrdersProps) {
  const [orders, setOrders] = useState<OrderView[]>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const { wallets } = useWallets();

  // Reload orders after any mutation
  const reload = async () => {
    try {
      const res = await fetch(`/api/business/${businessId}/order`);
      if (!res.ok) throw new Error(String(res.status));
      setOrders(await res.json());
      setReloadError(null);
    } catch {
      setReloadError("Couldn't refresh your orders. What's shown may be out of date; reload the page.");
    }
  };

  return (
    <div id="orders-page">
      {reloadError ? <InlineError className="mb-4">{reloadError}</InlineError> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <PageTitle>Orders</PageTitle>
          <Lead className="mt-3">What your business has ordered, from whom, and up to how much. An invoice has to match its order and its delivery before it can be paid.</Lead>
        </div>
        <Button id="btn-new-order" onClick={() => setCreating(true)}>New order</Button>
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No orders yet" className="mt-8">Create one when you want an invoice to be matched against it.</EmptyState>
      ) : (
        <div className="mt-8 border-t border-ink">
          <div className={`hidden gap-x-4 border-b border-rule py-3 text-sm text-graphite md:grid ${GRID}`} aria-hidden>
            <span>Order</span>
            <span>Vendor</span>
            <span>Kind</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Remaining</span>
            <span>Status</span>
          </div>
          <ul>
            {orders.map((o) => (
              <OrderRow
                key={o.poRef}
                order={o}
                open={expanded === o.poRef}
                onToggle={() => setExpanded(expanded === o.poRef ? null : o.poRef)}
                businessId={businessId}
                wallets={wallets}
                vendors={vendors}
                explorer={explorer}
                onMutate={reload}
              />
            ))}
          </ul>
        </div>
      )}

      {creating ? (
        <NewOrderSheet businessId={businessId} wallets={wallets} vendors={vendors} onClose={() => setCreating(false)} onMutate={reload} />
      ) : null}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function OrderRow({
  order: o,
  open,
  onToggle,
  businessId,
  wallets,
  vendors,
  explorer,
  onMutate,
}: {
  order: OrderView;
  open: boolean;
  onToggle: () => void;
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  vendors: KnownVendor[];
  explorer: string;
  onMutate: () => void;
}) {
  const closed = Boolean(o.closedAt);
  const liveOpen = o.live.ok ? o.live.open : !closed;
  const remaining = o.live.ok && o.live.remaining ? formatRaw(o.live.remaining) : null;
  const status = closed ? { label: "Closed", tone: "neutral" as const } : liveOpen ? { label: "Open", tone: "ok" as const } : { label: "Can’t confirm", tone: "warn" as const };
  const detailId = `po-detail-${o.poRef.slice(2, 10)}`;

  return (
    <li className="border-b border-rule-soft">
      <button
        id={`toggle-${o.poRef.slice(2, 10)}`}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={detailId}
        className={`grid w-full gap-x-4 gap-y-1 py-4 text-left transition-colors hover:bg-paper-raised ${GRID} md:items-center`}
      >
        <span className="flex items-baseline gap-2 font-medium text-ink">
          <span aria-hidden className="text-graphite">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 break-words">{o.poNumber}</span>
        </span>
        <span className="min-w-0 truncate pl-5 md:pl-0">{vendorName(vendors, o.seal)}</span>
        <span className="pl-5 text-graphite capitalize md:pl-0">{o.kind.replace("_", "-")}</span>
        <span className="pl-5 md:pl-0 md:text-right"><span className="text-graphite md:hidden">Amount </span><Money>{formatRaw(o.amount)}</Money></span>
        <span className="pl-5 md:pl-0 md:text-right"><span className="text-graphite md:hidden">Remaining </span><Money>{remaining ?? "—"}</Money></span>
        <span className="pl-5 md:pl-0"><StatusPill tone={status.tone}>{status.label}</StatusPill></span>
      </button>
      {open ? (
        <div id={detailId} className="bg-paper-raised/50 px-4">
          <OrderDetail order={o} businessId={businessId} wallets={wallets} explorer={explorer} onMutate={onMutate} />
        </div>
      ) : null}
    </li>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function OrderDetail({
  order: o,
  businessId,
  wallets,
  explorer,
  onMutate,
}: {
  order: OrderView;
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  explorer: string;
  onMutate: () => void;
}) {
  const closed = Boolean(o.closedAt);

  return (
    <div className="grid gap-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <DetailList
        items={[
          { label: "Description", value: o.description ?? "—" },
          { label: "Amount", value: <Money>{formatRaw(o.amount)}</Money> },
          { label: "Invoiced", value: o.invoiceCount > 0 ? `${formatRaw(o.invoicedTotal)} across ${o.invoiceCount} invoice${o.invoiceCount === 1 ? "" : "s"}` : "No invoices yet" },
          { label: "Paid", value: <Money>{formatRaw(o.paidTotal)}</Money> },
          { label: "Release after", value: o.releaseAfter ? formatDay(o.releaseAfter, { year: "always" }) : "No release date" },
          { label: "Opened", value: o.openTx ? <TxLink href={`${explorer}/tx/${o.openTx}`} label="View the opening transaction on the Arc explorer">{o.openTx.slice(0, 10)}…</TxLink> : "Not recorded" },
        ]}
      />
      <div>
        {!closed ? (
          <CloseButton businessId={businessId} poRef={o.poRef} poNumber={o.poNumber} wallets={wallets} onMutate={onMutate} />
        ) : (
          <p className="text-graphite">
            Closed {o.closedAt ? formatDay(o.closedAt, { year: "always" }) : ""}
            {o.closedTx ? (
              <>
                {" · "}
                <TxLink href={`${explorer}/tx/${o.closedTx}`} label="View the closing transaction on the Arc explorer">{o.closedTx.slice(0, 10)}…</TxLink>
              </>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Close button ─────────────────────────────────────────────────────────────

function CloseButton({
  businessId,
  poRef,
  poNumber,
  wallets,
  onMutate,
}: {
  businessId: string;
  poRef: string;
  poNumber: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onMutate: () => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const doClose = async () => {
    setStep("signing");
    setMsg(null);
    try {
      const wallet = wallets[0];
      if (!wallet) throw new Error("No wallet connected.");
      const prepared = await post(`/api/business/${businessId}/order`, { action: "prepare_close", poRef });
      await wallet.switchChain(prepared.chainId);
      const provider = await wallet.getEthereumProvider();
      const txHash: Hex = await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
      });
      setStep("recording");
      await post(`/api/business/${businessId}/order`, { action: "record_close", txHash, poRef });
      setStep("done");
      setMsg("Order closed.");
      setConfirming(false);
      onMutate();
    } catch (e) {
      setStep("error");
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  if (step === "done") return <p className="text-sm text-seal">Closed.</p>;

  return (
    <>
      {!confirming ? (
        <button
          id={`btn-close-${poRef.slice(2, 10)}`}
          onClick={() => setConfirming(true)}
          disabled={step === "signing" || step === "recording"}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Close order
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            Close <strong>{poNumber}</strong>? No more invoices can be matched against it after this. Amounts already
            paid stay paid.
          </p>
          <div className="flex gap-2">
            <button
              id={`btn-close-confirm-${poRef.slice(2, 10)}`}
              onClick={() => startTransition(doClose)}
              disabled={step === "signing" || step === "recording"}
              className={buttonClass()}
            >
              {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Close the order"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className={buttonClass({ variant: "secondary" })}
            >
              Back
            </button>
          </div>
        </div>
      )}
      {msg ? <p className={`text-sm ${step === "error" ? "text-red" : "text-graphite"}`}>{msg}</p> : null}
    </>
  );
}

// ─── New order sheet ──────────────────────────────────────────────────────────

function NewOrderSheet({
  businessId,
  wallets,
  vendors,
  onClose,
  onMutate,
}: {
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  vendors: KnownVendor[];
  onClose: () => void;
  onMutate: () => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [vendorWarning, setVendorWarning] = useState<string | null>(null);

  const [poNumber, setPoNumber] = useState("");
  // a vendor the business already knows is picked by name; a new one is entered by the address on their invoice
  const [pickedSeal, setPickedSeal] = useState(vendors[0]?.seal ?? "other");
  const [otherSeal, setOtherSeal] = useState("");
  const sealInput = pickedSeal === "other" ? otherSeal : pickedSeal;
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [releaseDate, setReleaseDate] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep("signing");
    setMsg(null);
    setVendorWarning(null);
    try {
      const wallet = wallets[0];
      if (!wallet) throw new Error("No wallet connected.");
      const prepared = await post(`/api/business/${businessId}/order`, {
        action: "prepare_open",
        poNumber,
        seal: sealInput,
        amount,
        description: description || undefined,
        releaseDate: releaseDate || undefined,
      });
      if (prepared.vendorWarning) setVendorWarning(prepared.vendorWarning);
      await wallet.switchChain(prepared.chainId);
      const provider = await wallet.getEthereumProvider();
      const txHash: Hex = await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
      });
      setStep("recording");
      await post(`/api/business/${businessId}/order`, {
        action: "record_open",
        txHash,
        poNumber: prepared.poNumber,
        description: prepared.description,
      });
      setStep("done");
      setMsg("Order opened.");
      onMutate();
      onClose();
    } catch (e) {
      setStep("error");
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <Overlay
      title="New order"
      description="The vendor quotes the order number on their invoice and the Steward matches it. The Vault checks every rule again before any payment leaves."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Order number">
          {(a) => (
            <input {...a} required value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2026-0044" maxLength={64} className={controlClass} />
          )}
        </Field>

        <Field label="Vendor">
          {(a) => (
            <select {...a} value={pickedSeal} onChange={(e) => setPickedSeal(e.target.value)} className={controlClass}>
              {vendors.map((v) => (
                <option key={v.seal} value={v.seal}>{v.name}</option>
              ))}
              <option value="other">Another vendor…</option>
            </select>
          )}
        </Field>

        {pickedSeal === "other" ? (
          <Field label="Their Seal address" hint="It is on their invoice and on their Symbolon profile.">
            {(a) => (
              <input {...a} required value={otherSeal} onChange={(e) => setOtherSeal(e.target.value)} placeholder="0x…" spellCheck={false} className={`${controlClass} font-mono`} />
            )}
          </Field>
        ) : null}

        <Field label="Amount (USDC)">
          {(a) => (
            <input {...a} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="14000.00" inputMode="decimal" className={controlClass} />
          )}
        </Field>

        <Field label="Description" optional>
          {(a) => (
            <input {...a} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="4 workstations for the design team" maxLength={500} className={controlClass} />
          )}
        </Field>

        <Field label="Not before" optional hint="The earliest date the Vault will pay against this order.">
          {(a) => <input {...a} type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={controlClass} />}
        </Field>

        {vendorWarning ? (
          <p className="rounded-doc border border-warn/40 bg-warn-wash px-3 py-2 text-warn">{vendorWarning}</p>
        ) : null}

        {msg ? (step === "error" ? <InlineError>{msg}</InlineError> : <p role="status" className="text-seal">{msg}</p>) : null}

        <Overlay.Footer>
          <Button id="btn-new-order-cancel" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button id="btn-open-order-submit" type="submit" busy={step === "signing" || step === "recording"}>
            {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Open the order"}
          </Button>
        </Overlay.Footer>
      </form>
    </Overlay>
  );
}
