"use client";

import Link from "next/link";
import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { Act } from "@/components/Act";

const payments = [
  { date: "28 Sep", vendor: "Studio Ana", invoice: "0143", fp: "0x3d9b…f308", po: "PO-0031", delivery: "Linear, 30 Sep", amount: "1,985.000000", tx: "0x4b7e…a91c", decision: "d-0912" },
  { date: "27 Sep", vendor: "Halden Freight", invoice: "88-11", fp: "0x71c2…04ae", po: "PO-0035", delivery: "Delivered 20 Sep", amount: "3,880.000000", tx: "0x0e92…c51b", decision: "d-0801" },
  { date: "24 Sep", vendor: "Cloudline", invoice: "CL-1011", fp: "0xa4f0…9d21", po: "—", delivery: "Not required", amount: "1,240.000000", tx: "0x5d31…e8f4", decision: "d-0802" },
  { date: "12 Sep", vendor: "Northwind Agency", invoice: "2250", fp: "0x0c5e…7ba3", po: "PO-0048", delivery: "Design milestone, 12 Sep", amount: "4,000.000000", tx: "0xb82a…1c07", decision: "d-0955" },
];

const paymentsCsv = [
  ["Date", "Vendor", "Invoice", "Fingerprint", "Order", "Delivery", "Amount (USDC)", "Transaction", "Record"],
  ...payments.map((p) => [p.date, p.vendor, p.invoice, p.fp, p.po, p.delivery, p.amount, p.tx, p.decision]),
]
  .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
  .join("\n");

const paymentsBeancount = payments
  .map(
    (p) =>
      `2026-09-${p.date.slice(0, 2)} * "${p.vendor}" "Invoice ${p.invoice}"\n  Expenses:Vendors:${p.vendor.replace(/\W+/g, "")}  ${p.amount.replace(/,/g, "")} USDC\n  Assets:Vault:Operating  -${p.amount.replace(/,/g, "")} USDC\n  ; fingerprint ${p.fp}  tx ${p.tx}  order ${p.po}`,
  )
  .join("\n\n");

/** Accounting (B20): payments that point at their documents, reconciliation that never rounds, exports, close */
export function AccountingView() {
  const [closed, setClosed] = useState(false);
  const [resolved, setResolved] = useState(false);
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Accounting</h1>
          <p className="mt-2 max-w-[64ch] text-graphite">Every payment exports with its invoice fingerprint, order, delivery, transaction and decision record. The Vault is the bank, so the books reconcile to the chain line by line.</p>
        </div>
        <div className="flex gap-2">
          <Act
            className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink"
            download={{ filename: "acme-payments.csv", mime: "text/csv", text: paymentsCsv }}
            done={`Downloaded acme-payments.csv (${payments.length} payments)`}
          >
            Export CSV
          </Act>
          <Act
            className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink"
            download={{ filename: "acme-payments.beancount", text: paymentsBeancount }}
            done={`Downloaded acme-payments.beancount (${payments.length} entries)`}
          >
            Export beancount
          </Act>
        </div>
      </div>

      <section data-reveal aria-labelledby="rec" className={`mt-8 rounded-doc border p-5 ${resolved ? "border-seal/40" : "border-red/60"}`}>
        <h2 id="rec" className="font-display text-2xl">
          September against the chain
        </h2>
        <p className="mt-1 text-sm">41 payments · {resolved ? "41 match" : "40 match, 1 doesn’t"}</p>
        {!resolved ? (
          <div className="mt-4 border-t border-red/30 pt-4">
            <p className="text-red">
              Reserve move on 28 Sep, 11:31 (<TxLink hash={tx.sweep}>tx {tx.sweep}</TxLink>)
            </p>
            <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-graphite">Books say</dt>
                <dd className="tabular-nums">$22,000.000000 into reserve</dd>
              </div>
              <div>
                <dt className="text-graphite">Chain says</dt>
                <dd className="tabular-nums">21,318.420000 USYC, worth $21,998.730000</dd>
              </div>
              <div>
                <dt className="text-graphite">Difference</dt>
                <dd className="tabular-nums text-red">$1.270000, the Teller’s fee</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-graphite">Shown, not rounded away. Book it as a fee to close the gap.</p>
            <button onClick={() => setResolved(true)} className="mt-3 rounded-doc bg-ink px-3 py-2 text-sm font-medium text-paper">
              Book $1.27 as a reserve fee
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-seal">✓ Booked $1.270000 as a reserve fee. Every line matches.</p>
        )}
      </section>

      <section data-reveal aria-labelledby="pays" className="mt-10">
        <h2 id="pays" className="font-display text-3xl">
          Payments
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] border-t border-ink text-sm">
            <thead>
              <tr className="text-left text-xs text-graphite">
                {["Date", "Vendor", "Invoice", "Fingerprint", "Order", "Delivery", "Amount (USDC)", "Transaction", "Why"].map((h) => (
                  <th key={h} className={`py-3 pr-4 font-normal ${h.startsWith("Amount") ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.tx} className="border-t border-rule">
                  <td className="py-3 pr-4">{p.date}</td>
                  <td className="pr-4">{p.vendor}</td>
                  <td className="pr-4 font-mono">{p.invoice}</td>
                  <td className="pr-4 font-mono text-xs">{p.fp}</td>
                  <td className="pr-4">{p.po}</td>
                  <td className="pr-4 text-graphite">{p.delivery}</td>
                  <td className="pr-4 text-right tabular-nums">{p.amount}</td>
                  <td className="pr-4">
                    <TxLink hash={p.tx}>{p.tx}</TxLink>
                  </td>
                  <td>
                    <Link href={`/b/decisions/${p.decision}`} className="underline decoration-rule underline-offset-4">
                      Record
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section data-reveal aria-labelledby="conn">
          <h2 id="conn" className="font-display text-3xl">
            Connect your books
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-3">
            {["Xero", "QuickBooks", "Odoo", "ERPNext"].map((c, i) => (
              <li key={c} className="rounded-doc border border-rule p-4">
                <p className="font-medium">{c}</p>
                <p className={`mt-2 text-sm ${i === 0 ? "text-seal" : ""}`}>{i === 0 ? "✓ Syncing daily" : <Act className="underline decoration-rule underline-offset-4" done={`✓ Connected to ${c}; first sync tonight`}>Connect</Act>}</p>
              </li>
            ))}
          </ul>
        </section>
        <section data-reveal aria-labelledby="close">
          <h2 id="close" className="font-display text-3xl">
            Close September
          </h2>
          <p className="mt-2 text-sm text-graphite">Closing locks the period’s export. Every payment already has its invoice, match, record and transaction.</p>
          {closed ? (
            <p role="status" className="mt-4 text-seal">
              ✓ September closed and sent to Xero.
            </p>
          ) : (
            <button disabled={!resolved} onClick={() => setClosed(true)} className="mt-4 rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper disabled:opacity-40">
              Close September
            </button>
          )}
          {!resolved && !closed ? <p className="mt-2 text-sm text-red">Resolve the mismatch first.</p> : null}
        </section>
      </div>
    </main>
  );
}
