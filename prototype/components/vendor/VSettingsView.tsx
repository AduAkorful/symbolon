"use client";

import { useState } from "react";
import { Act } from "@/components/Act";
import { vInvoices } from "@/lib/ana";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";
import { ImageUpload } from "@/components/ImageUpload";
import Link from "next/link";

const tabs = ["Profile", "Getting paid", "Early Pay", "Reminders", "Seal", "Team", "Exports"] as const;
type Tab = (typeof tabs)[number];

/** Vendor settings (V12–V16): profile, payout and address changes, Early Pay, reminders, the Seal, team, exports */
export function VSettingsView() {
  const { vendorLogo, setVendorLogo } = useProfile();
  const [tab, setTab] = useState<Tab>("Getting paid");
  const [change, setChange] = useState<"none" | "signing" | "pending">("none");
  const [recover, setRecover] = useState(false);
  const input = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2";
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 className="font-display text-5xl">Settings</h1>
      <div role="tablist" className="mt-6 flex flex-wrap gap-1 border-b border-rule">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-ink" : "border-transparent text-graphite hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-8 max-w-2xl">
        {tab === "Profile" ? (
          <form className="space-y-4">
            <p className="text-sm text-graphite">
              This is your Seal’s public profile. Your own photo, contact details and notifications are in{" "}
              <Link href="/v/profile" className="underline decoration-rule underline-offset-4">
                your profile
              </Link>
              .
            </p>
            <ImageUpload label="Logo" name="Studio Ana" value={vendorLogo} onChange={setVendorLogo} hint="PNG, JPEG or WebP, up to 2 MB. It appears on your invoice link and PDF and on your profile." />
            <div className="rounded-doc border border-rule p-4 text-sm">
              <p className="font-medium">Who sees your logo</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <Avatar name="Studio Ana" src={vendorLogo} size={40} />
                  <p>
                    Clients who have verified you, and anyone opening your invoice, because <span className="font-mono">studio-ana.com</span> is verified.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Avatar name="Studio Ana" src={vendorLogo} show={false} size={40} />
                  <p className="text-graphite">A new client before they verify you, if your domain weren’t verified. A logo alone never earns trust.</p>
                </div>
              </div>
            </div>
            <label className="block text-sm">
              Name on invoices<input className={input} defaultValue="Studio Ana" />
            </label>
            <label className="block text-sm">
              Legal name<input className={input} defaultValue="Ana Ferreira Design, Lda." />
            </label>
            <label className="block text-sm">
              Tax ID<input className={input} defaultValue="PT 514 882 310" />
            </label>
            <label className="block text-sm">
              Address<input className={input} defaultValue="Rua das Flores 21, Lisbon" />
            </label>
            <div className="rounded-doc border border-rule p-4 text-sm">
              <p className="font-medium">Domain</p>
              <p className="mt-1 text-seal">✓ studio-ana.com verified by DNS record, 4 Sep</p>
              <p className="mt-1 text-graphite">A badge on your profile. Clients still confirm you once themselves.</p>
            </div>
            <button type="button" className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
              Save
            </button>
          </form>
        ) : null}

        {tab === "Getting paid" ? (
          <div className="space-y-8">
            <dl className="border-t border-ink text-sm">
              {[
                ["Default", "USDC on Arc to 0x7a3f…c219"],
                ["Halden Retail", "USDC on Base (per-client)"],
                ["Screening", "✓ Low risk, checked 21 Sep"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_1fr] border-b border-rule py-2.5">
                  <dt className="text-graphite">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <section aria-labelledby="change">
              <h2 id="change" className="font-display text-2xl">
                Change where you’re paid
              </h2>
              <p className="mt-1 text-sm text-graphite">Signed by your Seal. Each client confirms it, and it can’t be used for 72 hours. Invoices you’ve already sealed keep the old address.</p>
              {change === "none" ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setChange("signing");
                  }}
                  className="mt-4 space-y-3"
                >
                  <input required aria-label="New address" placeholder="0x…" pattern="0x[0-9a-fA-F]{40}" className={`${input} font-mono text-sm`} />
                  <button className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">Continue</button>
                </form>
              ) : change === "signing" ? (
                <div className="mt-4 rounded-doc border border-rule p-4">
                  <p>Your Seal signs: “From now on, pay @studio-ana at the new address, on Arc.” Your clients are told at once.</p>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setChange("pending")} className="rounded-doc bg-ink px-4 py-2 text-sm text-paper">
                      Sign
                    </button>
                    <button onClick={() => setChange("none")} className="rounded-doc border border-rule px-4 py-2 text-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <ul role="status" className="mt-4 border-t border-ink text-sm">
                  {[
                    ["Acme Operations", "Waiting for their confirmation · usable in 72 h"],
                    ["Halden Retail", "Confirmed · usable in 72 h"],
                  ].map(([c, s]) => (
                    <li key={c} className="flex justify-between gap-4 border-b border-rule py-2.5">
                      <span>{c}</span>
                      <span className="text-graphite">{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === "Early Pay" ? (
          <div className="space-y-6">
            <p className="text-sm text-graphite">Your default curve, added to new invoices. You can change it per invoice.</p>
            <p>1.5% within 3 days · 0.75% within 15 days</p>
            <label className="flex items-start gap-3 rounded-doc border border-rule p-4 text-sm">
              <input type="checkbox" defaultChecked className="mt-1" />
              <span>
                Accept any early-payment offer up to <strong>1.5%</strong> without asking me
                <span className="block text-graphite">Clients’ Stewards can then pay you early inside this limit. Offers above it come to you.</span>
              </span>
            </label>
          </div>
        ) : null}

        {tab === "Reminders" ? (
          <ul className="border-t border-ink text-sm">
            {[
              ["Acme Operations", "Off: pays through its Steward"],
              ["Kite & Co", "On: a polite note 3 days before and on the due date"],
              ["Morrow Labs", "On"],
            ].map(([c, s]) => (
              <li key={c} className="flex justify-between gap-4 border-b border-rule py-3">
                <span>{c}</span>
                <span className="text-graphite">{s}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {tab === "Seal" ? (
          <div className="space-y-8">
            <section>
              <h2 className="font-display text-2xl">Rotate your Seal</h2>
              <p className="mt-1 text-sm text-graphite">Your current key signs over to a new one. Clients are told and the new key waits out their cooldown. Use this for a new device.</p>
              <div className="mt-3">
                <Act
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                  confirm={{ title: "Rotate your Seal", body: "Your current key signs over to the new one. Each client is told and confirms, and the new key waits out their 72-hour cooldown before it can be paid.", action: "Sign and rotate" }}
                  done="Rotation requested. Your current key keeps working until each client confirms and the 72-hour cooldown ends."
                >
                  Rotate
                </Act>
              </div>
            </section>
            <section className="rounded-doc border border-red/40 p-5">
              <h2 className="font-display text-2xl">Lost your key?</h2>
              <p className="mt-1 text-sm">
                Recovery is slow on purpose: we re-check who you are, there’s a longer wait, and every client verifies you again before paying the
                recovered Seal. That’s what stops someone else doing this in your name.
              </p>
              {recover ? (
                <ol role="status" className="mt-4 space-y-1.5 text-sm">
                  <li>1. Identity check with Symbolon · started</li>
                  <li className="text-graphite">2. Seven-day wait</li>
                  <li className="text-graphite">3. Each client confirms you again and adds the recovered Seal</li>
                </ol>
              ) : (
                <button onClick={() => setRecover(true)} className="mt-3 rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash">
                  Start recovery
                </button>
              )}
            </section>
          </div>
        ) : null}

        {tab === "Team" ? (
          <div>
            <ul className="border-t border-ink text-sm">
              {[
                ["Ana Ferreira", "Owner · seals invoices"],
                ["Rui Costa", "Drafts invoices · can’t seal"],
              ].map(([n, r]) => (
                <li key={n} className="flex justify-between border-b border-rule py-3">
                  <span>{n}</span>
                  <span className="text-graphite">{r}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Act
                className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                confirm={{ title: "Invite a teammate", body: "They can prepare invoices. Only your Seal can sign them.", action: "Send invitation", field: { label: "Their email", placeholder: "name@studio-ana.example", inputMode: "email" } }}
                done={(email) => `Invitation sent to ${email}.`}
              >
                Invite a teammate
              </Act>
            </div>
          </div>
        ) : null}

        {tab === "Exports" ? (
          <div className="space-y-3">
            <p className="text-sm text-graphite">Everything you’ve invoiced and been paid, for your accountant or tax return.</p>
            <div className="flex flex-wrap gap-2">
              {["CSV", "PDF statement", "Xero", "QuickBooks"].map((f) => (
                <Act
                  key={f}
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                  {...(f === "CSV"
                    ? { download: { filename: "studio-ana-invoices.csv", mime: "text/csv", text: ["Invoice,Client,Issued,Due,Status", ...vInvoices.map((i) => [i.number, i.client, i.issued, i.due, i.status].map((c) => `"${c}"`).join(","))].join("\n") } }
                    : {})}
                  done={f === "CSV" ? `Downloaded studio-ana-invoices.csv (${vInvoices.length} invoices)` : f === "PDF statement" ? "Statement for September ready (demo)" : `✓ Connected to ${f}; paid invoices sync as they settle`}
                >
                  {f}
                </Act>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
