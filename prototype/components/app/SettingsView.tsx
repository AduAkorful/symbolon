"use client";

import Link from "next/link";
import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { VAULT_ADDRESS, tx } from "@/lib/tx";
import { ReleaseCard } from "./ReleaseCard";
import { useRelease } from "./release";
import { ImageUpload } from "@/components/ImageUpload";
import { useProfile } from "@/components/profile";

/** Vault settings and upgrades (B23), notifications (B24) */
export function SettingsView() {
  const [auto, setAuto] = useState<"off" | "queued">("off");
  const release = useRelease();
  const applied = release.state === "applied";
  const { businessLogo, setBusinessLogo } = useProfile();
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Settings
      </h1>
      <section data-reveal aria-labelledby="business" className="mt-10 max-w-2xl">
        <h2 id="business" className="font-display text-3xl">
          Business
        </h2>
        <div className="mt-4 border-t border-ink pt-5">
          <ImageUpload
            label="Logo"
            name="Acme Operations"
            value={businessLogo}
            onChange={setBusinessLogo}
            hint="PNG, JPEG or WebP, up to 2 MB. It shows in your sidebar and on receipts and emails. Vendors see it once they’ve invoiced you or been paid; before that they see initials."
          />
          <p className="mt-4 text-xs text-graphite">A logo is decoration. Vendors confirm who you are the same way you confirm them, and never by a picture.</p>
        </div>
      </section>
      <div className="mt-12 grid gap-12 xl:grid-cols-2">
        <section data-reveal aria-labelledby="vault">
          <h2 id="vault" className="font-display text-3xl">
            Vault
          </h2>
          <dl className="mt-4 border-t border-ink text-sm">
            {[
              ["Address", "0x5f5e…2984 on Arc"],
              ["Owner", "You (wallet 0x74b4…0ffd)"],
              ["Steward key", "0x51c9…e20b"],
              ["Release", applied ? "3 (latest) · upgraded just now" : "2 · release 3 available"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[8rem_1fr] border-b border-rule py-2.5">
                <dt className="text-graphite">{k}</dt>
                <dd className={k === "Address" || k === "Steward key" ? "font-mono" : ""}>
                  {v}
                  {k === "Address" ? (
                    <TxLink kind="address" hash={VAULT_ADDRESS} className="ml-3 font-sans">
                      Explorer
                    </TxLink>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <h3 id="upgrades" className="mt-8 scroll-mt-24 font-medium">
            Upgrades
          </h3>
          <p className="mt-1 text-sm text-graphite">
            Your Vault only changes when you say so. You schedule a release, it waits your 24-hour delay, then you apply it. You can cancel any time before.
          </p>
          <ReleaseCard />
          <ol className="mt-5 border-t border-rule text-sm">
            {applied ? (
              <li className="flex justify-between border-b border-rule py-2">
                <span>Release 3 · clearer refusal reasons</span>
                <span className="text-graphite">
                  Applied just now · <TxLink hash={tx.upgradeApply}>{tx.upgradeApply}</TxLink>
                </span>
              </li>
            ) : null}
            <li className="flex justify-between border-b border-rule py-2">
              <span>Release 2 · reserve in USYC</span>
              <span className="text-graphite">
                Applied 28 Sep · <TxLink hash={tx.releaseTwo}>{tx.releaseTwo}</TxLink>
              </span>
            </li>
            <li className="flex justify-between border-b border-rule py-2">
              <span>Release 1</span>
              <span className="text-graphite">
                Created 26 Sep · <TxLink hash={tx.createVault}>{tx.createVault}</TxLink>
              </span>
            </li>
          </ol>
          <div className="mt-5 rounded-doc border border-rule p-4">
            <p className="font-medium">Automatic updates</p>
            <p className="mt-1 text-sm text-graphite">Off. If on, published releases apply by themselves after your delay, and you can still cancel any one. Turning it on waits 24 hours.</p>
            {auto === "off" ? (
              <button onClick={() => setAuto("queued")} className="mt-3 rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink">
                Turn on
              </button>
            ) : (
              <p role="status" className="mt-3 text-sm">
                Queued: turns on in 24 h 00 m. <TxLink hash={tx.autoUpdateQueue}>Queued in {tx.autoUpdateQueue}</TxLink>{" "}
                <button onClick={() => setAuto("off")} className="underline decoration-rule underline-offset-4">Cancel</button>
              </p>
            )}
          </div>
        </section>

        <section data-reveal aria-labelledby="notif">
          <h2 id="notif" className="font-display text-3xl">
            Notifications
          </h2>
          <p className="mt-3 max-w-[52ch] text-sm text-graphite">
            How you’re reached is personal, and one person can belong to several accounts. Each person sets up their own email, Slack, Telegram and push, and chooses what goes where, in their profile.
          </p>
          <Link href="/b/profile#reach" className="mt-4 inline-block rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
            Set up your notifications
          </Link>
          <p className="mt-6 text-sm text-graphite">Approvals can be signed straight from email, Slack or Telegram, on your own device.</p>
          <Link href="/channels" className="mt-2 inline-block text-sm underline decoration-rule underline-offset-4">
            See what these look like
          </Link>
        </section>
      </div>
    </main>
  );
}
