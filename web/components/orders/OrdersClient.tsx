"use client";

import { useState, useTransition, useId } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import { encodeFunctionData, type Hex } from "viem";
import { Overlay } from "@/components/Overlay";

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

interface OrdersProps {
  businessId: string;
  initial: OrderView[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRaw(raw: string, label = "token units"): string {
  // raw is a bigint string of 6-decimal USDC/EURC units
  const n = BigInt(raw);
  const units = Number(n / 1_000_000n);
  const frac = String(n % 1_000_000n).padStart(6, "0").replace(/0+$/, "") || "00";
  return `${units.toLocaleString()}.${frac.slice(0, 2)} ${label}`;
}

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

// ─── Main component ───────────────────────────────────────────────────────────

export function OrdersClient({ businessId, initial }: OrdersProps) {
  const [orders, setOrders] = useState<OrderView[]>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { wallets } = useWallets();
  const { user: privyUser } = usePrivy();

  // Reload orders after any mutation
  const reload = async () => {
    try {
      const res = await fetch(`/api/business/${businessId}/order`);
      if (res.ok) setOrders(await res.json());
    } catch { /* keep stale */ }
  };

  return (
    <div id="orders-page" className="max-w-[1080px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Orders</h1>
          <p className="mt-2 max-w-[64ch] text-graphite">
            What your business has ordered, from whom, and up to how much. An invoice matches its order and its
            delivery before it can be paid.
          </p>
        </div>
        <button
          id="btn-new-order"
          onClick={() => setCreating(true)}
          className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-80"
        >
          New order
        </button>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[800px] border-t border-ink text-[15px]">
          <thead>
            <tr className="text-left text-xs text-graphite">
              <th className="py-3 pr-4 font-normal">Order</th>
              <th className="py-3 pr-4 font-normal">Vendor seal</th>
              <th className="py-3 pr-4 font-normal">Kind</th>
              <th className="py-3 pr-4 text-right font-normal">Amount</th>
              <th className="py-3 pr-4 text-right font-normal">Remaining</th>
              <th className="py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-graphite">
                  No orders yet. Create one when you want to let an invoice match against it.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <OrderRow
                  key={o.poRef}
                  order={o}
                  open={expanded === o.poRef}
                  onToggle={() => setExpanded(expanded === o.poRef ? null : o.poRef)}
                  businessId={businessId}
                  wallets={wallets}
                  onMutate={reload}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating ? (
        <NewOrderSheet businessId={businessId} wallets={wallets} onClose={() => setCreating(false)} onMutate={reload} />
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
  onMutate,
}: {
  order: OrderView;
  open: boolean;
  onToggle: () => void;
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onMutate: () => void;
}) {
  const closed = Boolean(o.closedAt);
  const liveOpen = o.live.ok ? o.live.open : !closed;
  const remaining = o.live.ok && o.live.remaining ? formatRaw(o.live.remaining) : null;
  const statusLabel = closed ? "Closed" : liveOpen ? "Open" : "—";
  const statusStyle = closed ? "text-graphite" : liveOpen ? "text-seal" : "text-red";

  return (
    <>
      <tr className="border-t border-rule">
        <td className="pr-4">
          <button
            id={`toggle-${o.poRef.slice(2, 10)}`}
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`po-detail-${o.poRef.slice(2, 10)}`}
            className="py-4 font-mono text-sm hover:text-seal"
          >
            {open ? "▾" : "▸"} {o.poNumber}
          </button>
        </td>
        <td className="pr-4 font-mono text-xs text-graphite">
          {o.seal.slice(0, 8)}…{o.seal.slice(-4)}
        </td>
        <td className="pr-4 text-sm capitalize">{o.kind.replace("_", "-")}</td>
        <td className="pr-4 text-right tabular-nums">{formatRaw(o.amount)}</td>
        <td className="pr-4 text-right tabular-nums">{remaining ?? "—"}</td>
        <td className={`text-sm ${statusStyle}`}>{statusLabel}</td>
      </tr>
      {open ? (
        <tr id={`po-detail-${o.poRef.slice(2, 10)}`}>
          <td colSpan={6} className="bg-paper-raised/50 px-4">
            <OrderDetail order={o} businessId={businessId} wallets={wallets} onMutate={onMutate} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function OrderDetail({
  order: o,
  businessId,
  wallets,
  onMutate,
}: {
  order: OrderView;
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onMutate: () => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const closed = Boolean(o.closedAt);

  const sendTx = async (action: "prepare_close" | string, extra: Record<string, unknown> = {}) => {
    setStep("signing");
    setMsg(null);
    try {
      const wallet = wallets[0];
      if (!wallet) throw new Error("No wallet connected.");
      const prepared = await post(`/api/business/${businessId}/order`, { action, poRef: o.poRef, ...extra });
      await wallet.switchChain(prepared.chainId);
      const provider = await wallet.getEthereumProvider();
      const txHash: Hex = await provider.request({
        method: "eth_sendTransaction",
        params: [{ to: prepared.to, data: prepared.data, from: wallet.address }],
      });
      setStep("recording");
      await post(`/api/business/${businessId}/order`, { action: "record_close", txHash, poRef: o.poRef });
      setStep("done");
      setMsg("Order closed.");
      onMutate();
    } catch (e) {
      setStep("error");
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div className="grid gap-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <dl className="space-y-1.5 text-sm">
        {[
          ["Description", o.description ?? "—"],
          ["Amount", formatRaw(o.amount)],
          ["Invoiced", o.invoiceCount > 0 ? `${formatRaw(o.invoicedTotal)} across ${o.invoiceCount} invoice${o.invoiceCount === 1 ? "" : "s"}` : "No invoices yet"],
          ["Paid", formatRaw(o.paidTotal)],
          ["Release after", o.releaseAfter ? new Date(o.releaseAfter).toISOString().slice(0, 10) : "No release date"],
          ["Opened", o.openTx ? <a key="tx" href={`https://explorer.arc.net/tx/${o.openTx}`} target="_blank" rel="noreferrer" className="underline decoration-rule underline-offset-4">{`tx ${o.openTx.slice(0, 10)}…`}</a> : "Not recorded"],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex gap-3">
            <dt className="w-28 shrink-0 text-graphite">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        {!closed ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <CloseButton
              businessId={businessId}
              poRef={o.poRef}
              poNumber={o.poNumber}
              wallets={wallets}
              onMutate={onMutate}
            />
          </div>
        ) : (
          <p className="text-sm text-graphite">
            Closed {o.closedAt ? new Date(o.closedAt).toISOString().slice(0, 10) : ""}
            {o.closedTx ? (
              <>
                {" · "}
                <a
                  href={`https://explorer.arc.net/tx/${o.closedTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-rule underline-offset-4"
                >
                  tx {o.closedTx.slice(0, 10)}…
                </a>
              </>
            ) : null}
          </p>
        )}
        {msg ? (
          <p className={`mt-3 text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p>
        ) : null}
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
          className="rounded-doc border border-rule px-3 py-1.5 text-xs hover:border-ink disabled:opacity-50"
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
              className="rounded-doc bg-ink px-3 py-2 text-sm text-paper disabled:opacity-50"
            >
              {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Close the order"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-doc border border-rule px-3 py-2 text-sm"
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
  onClose,
  onMutate,
}: {
  businessId: string;
  wallets: ReturnType<typeof useWallets>["wallets"];
  onClose: () => void;
  onMutate: () => void;
}) {
  const headingId = useId();
  const [step, setStep] = useState<Step>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [vendorWarning, setVendorWarning] = useState<string | null>(null);

  const [poNumber, setPoNumber] = useState("");
  const [sealInput, setSealInput] = useState("");
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
    <Overlay label={{ id: headingId }} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-7">
        <h2 id={headingId} className="font-display text-3xl">New order</h2>
        <p className="text-sm text-graphite">
          The vendor quotes this order number on their invoice; the Steward matches it. The Vault checks every rule
          again before any payment leaves.
        </p>

        <label className="block text-sm">
          PO number
          <input
            id="input-po-number"
            required
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="PO-2026-0044"
            maxLength={64}
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          Vendor Seal address
          <input
            id="input-vendor-seal"
            required
            value={sealInput}
            onChange={(e) => setSealInput(e.target.value)}
            placeholder="0x…"
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2 font-mono text-xs"
          />
          <span className="mt-1 block text-xs text-graphite">
            The vendor's signing key — find it on their invoice or their Symbolon profile.
          </span>
        </label>

        <label className="block text-sm">
          Amount (in token units, e.g. 14000.00 for $14,000.00 USDC)
          <input
            id="input-amount"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="14000.00"
            inputMode="decimal"
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          Description (optional)
          <input
            id="input-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="4 workstations for the design team"
            maxLength={500}
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          Not before (optional — earliest date the Vault will pay against this order)
          <input
            id="input-release-date"
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
          />
        </label>

        {vendorWarning ? (
          <p className="rounded-doc border border-amber-400/30 bg-amber-50/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            {vendorWarning}
          </p>
        ) : null}

        {msg ? (
          <p className={`text-sm ${step === "error" ? "text-red" : "text-seal"}`}>{msg}</p>
        ) : null}

        <div className="flex gap-3">
          <button
            id="btn-open-order-submit"
            type="submit"
            disabled={step === "signing" || step === "recording"}
            className="flex-1 rounded-doc bg-ink py-2.5 font-medium text-paper disabled:opacity-50"
          >
            {step === "signing" ? "Waiting for wallet…" : step === "recording" ? "Recording…" : "Open the order"}
          </button>
          <button
            type="button"
            id="btn-new-order-cancel"
            onClick={onClose}
            className="rounded-doc border border-rule px-4 py-2.5"
          >
            Cancel
          </button>
        </div>
      </form>
    </Overlay>
  );
}
