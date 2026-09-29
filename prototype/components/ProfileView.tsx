"use client";

import Link from "next/link";
import { useState } from "react";
import { Act } from "@/components/Act";
import { ChannelSetup } from "@/components/ChannelSetup";
import { ImageUpload } from "@/components/ImageUpload";
import { ACCOUNTS, CHANNELS, useNotify } from "@/components/notify";
import { useProfile } from "@/components/profile";

const PERSON = "Ana Ferreira";

/** Which messages go where for one account, one row per kind of message; a channel that isn't set up is off and says so */
function Routing({ account, role, events }: { account: string; role: string; events: string[] }) {
  const { connected, routes, toggle } = useNotify();
  return (
    <section aria-labelledby={`route-${account}`} className="rounded-doc border border-rule p-5">
      <h3 id={`route-${account}`} className="font-display text-2xl">
        {account} <span className="font-sans text-sm text-graphite">· {role}</span>
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] border-t border-ink text-sm">
          <thead>
            <tr className="text-left text-xs text-graphite">
              <th className="py-3 pr-4 font-normal">When</th>
              {CHANNELS.map((c) => (
                <th key={c} className="py-3 text-center font-normal">
                  {c}
                  {!connected[c] ? (
                    <a href={`#channel-${c.toLowerCase()}`} className="block text-[11px] underline decoration-rule underline-offset-2">
                      Set up
                    </a>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e} className="border-t border-rule">
                <td className="py-2.5 pr-4">{e}</td>
                {CHANNELS.map((c) => (
                  <td key={c} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${e} by ${c}${connected[c] ? "" : " (set it up first)"}`}
                      disabled={!connected[c]}
                      title={connected[c] ? undefined : `Set up ${c} first`}
                      checked={connected[c] && (routes[e] ?? []).includes(c)}
                      onChange={() => toggle(e, c)}
                      className="disabled:opacity-30"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Your profile: you, not a business. Photo and name, how to reach you (each channel's details are entered here), what
 * goes where for each account you belong to, and how you sign in. One person can be a business owner and a vendor, so
 * this is the same page from both apps.
 */
export function ProfileView({ side }: { side: "business" | "vendor" }) {
  const { photos, setPhoto } = useProfile();
  const [name, setName] = useState(PERSON);
  const [saved, setSaved] = useState(false);
  // The account you came from is listed first
  const accounts = side === "business" ? ACCOUNTS : [...ACCOUNTS].reverse();
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Your profile
      </h1>
      <p data-reveal className="mt-2 max-w-[64ch] text-graphite">
        This is you, across every account you belong to. Businesses and Seals have their own settings; how you’re reached is yours.
      </p>

      <section data-reveal aria-labelledby="you" className="mt-10 max-w-3xl">
        <h2 id="you" className="font-display text-3xl">
          You
        </h2>
        <div className="mt-4 grid gap-6 border-t border-ink pt-5 sm:grid-cols-[auto_1fr]">
          <ImageUpload
            label="Photo"
            name={name}
            letters={2}
            mode="photo"
            value={photos["You"]}
            onChange={(u) => setPhoto("You", u)}
            hint="Optional. Teammates see it next to your name inside your business; others see initials. An approval is always attributed by your name and signature, never by the picture."
          />
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(true);
            }}
          >
            <label className="block text-sm">
              Name shown to teammates
              <input
                value={name}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2"
              />
            </label>
            <div className="flex items-center gap-3">
              <button className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">Save</button>
              {saved ? (
                <span role="status" className="text-sm text-seal">
                  Saved.
                </span>
              ) : null}
            </div>
          </form>
        </div>
      </section>

      <section data-reveal aria-labelledby="reach" className="mt-14">
        <h2 id="reach" className="font-display text-3xl">
          How to reach you
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">Set up each way here. Nothing is sent to one until it’s set up, and every approval is still signed on your own device.</p>
        <div className="mt-5">
          <ChannelSetup />
        </div>
      </section>

      <section data-reveal aria-labelledby="what" className="mt-14">
        <h2 id="what" className="font-display text-3xl">
          What to send, and where
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm text-graphite">
          Choose for each account you belong to.{" "}
          <Link href="/channels" className="underline decoration-rule underline-offset-4">
            See what these look like
          </Link>
        </p>
        <div className="mt-5 grid gap-6 xl:grid-cols-2">
          {accounts.map((a) => (
            <Routing key={a.account} {...a} />
          ))}
        </div>
      </section>

      <section data-reveal aria-labelledby="signin" className="mt-14 max-w-3xl">
        <h2 id="signin" className="font-display text-3xl">
          Signing in
        </h2>
        <dl className="mt-4 border-t border-ink text-sm">
          {[
            ["Sign-in", "An emailed code to owner@acme.example"],
            ["Wallet", "0x74b4…0ffd, created for you; you sign approvals with it"],
            ["Recovery", "Your email plus a waiting period. Slow on purpose."],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 border-b border-rule py-2.5">
              <dt className="text-graphite">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4">
          <Act
            className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
            confirm={{ title: "Sign out everywhere", body: "Every browser and phone signed in as you is signed out. You sign back in with an emailed code.", action: "Sign out everywhere" }}
            done="Signed out everywhere else. This device stays signed in."
          >
            Sign out everywhere
          </Act>
        </div>
      </section>
    </main>
  );
}
