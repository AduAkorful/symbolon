"use client";

import Link from "next/link";
import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const members = [
  { name: "You", email: "owner@acme.example", role: "Owner", scope: "Everything; signs above $10,000.00" },
  { name: "Ama Owusu", email: "ama@acme.example", role: "Approver", scope: "Marketing, Operations" },
  { name: "Dele Adeyemi", email: "dele@acme.example", role: "Requester", scope: "Raises orders, confirms delivery" },
  { name: "Kofi Mensah", email: "kofi@acme.example", role: "Requester", scope: "Engineering orders" },
  { name: "Ledger & Co", email: "books@ledgerco.example", role: "Accountant", scope: "Reads everything; exports" },
];

/** Team and roles (B22) */
export function TeamView() {
  const { photos } = useProfile();
  const [inviting, setInviting] = useState(false);
  const [transfer, setTransfer] = useState<"idle" | "sent">("idle");
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Team</h1>
          <p className="mt-2 max-w-[64ch] text-graphite">
            Roles are enforced by the Vault. Giving someone more power is a loosening change, so it waits 24 hours. The Steward can never hold a
            role or count as an approver.
          </p>
        </div>
        <button onClick={() => setInviting(!inviting)} className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
          Invite someone
        </button>
      </div>
      {inviting ? (
        <form
          data-reveal
          onSubmit={(e) => {
            e.preventDefault();
            setInviting(false);
          }}
          className="mt-6 grid max-w-3xl gap-3 rounded-doc border border-rule p-5 sm:grid-cols-[1fr_12rem_auto]"
        >
          <input required type="email" placeholder="name@acme.example" aria-label="Email" className="rounded-doc border border-rule bg-paper px-3 py-2" />
          <select aria-label="Role" className="rounded-doc border border-rule bg-paper px-3 py-2">
            {["Approver", "Requester", "Accountant (read-only)", "Screener"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">Send invite</button>
        </form>
      ) : null}
      <p data-reveal className="mt-6 text-sm text-graphite">
        Your own photo and name are set in{" "}
        <Link href="/b/profile" className="underline decoration-rule underline-offset-4">
          your profile
        </Link>
        . An approval is always attributed by name and signature, never by the picture.
      </p>
      <ul data-reveal className="mt-6 border-t border-ink">
        {members.map((m) => (
          <li key={m.email} className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[14rem_9rem_1fr]">
            <span className="flex items-center gap-3">
              <Avatar name={m.name === "You" ? "Ana Ferreira" : m.name} src={photos[m.name]} size={36} letters={2} />
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-graphite">{m.email}</span>
              </span>
            </span>
            <span className="text-sm">{m.role}</span>
            <span className="text-sm text-graphite">{m.scope}</span>
          </li>
        ))}
      </ul>
      <section data-reveal aria-labelledby="own" className="mt-12 max-w-2xl">
        <h2 id="own" className="font-display text-3xl">
          Hand over ownership
        </h2>
        <p className="mt-2 text-sm text-graphite">Two steps: you name the new owner, then they accept from their own account. Until they accept, you stay the owner.</p>
        {transfer === "idle" ? (
          <button onClick={() => setTransfer("sent")} className="mt-4 rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
            Name a new owner
          </button>
        ) : (
          <p role="status" className="mt-4 text-sm">
            Waiting for Ama Owusu to accept. <TxLink hash={tx.ownerTransfer}>Named in {tx.ownerTransfer}</TxLink> <button onClick={() => setTransfer("idle")} className="underline decoration-rule underline-offset-4">Withdraw</button>
          </p>
        )}
      </section>
    </main>
  );
}
