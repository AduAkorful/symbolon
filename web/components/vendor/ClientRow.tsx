"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAddress, isAddress } from "viem";

import { Address } from "@/components/Address";
import { useConfirm } from "@/components/useConfirm";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/Field";
import { InlineError } from "@/components/ui/States";
import { postJson } from "@/lib/client/api";
import { shortenAddressesIn } from "@/lib/format";

export interface ClientRowData {
  id: string;
  name: string;
  vault: string | null;
  email: string | null;
}

/** One client, with edit and remove (QA NEW-7). Sealed invoices keep the payer they were signed with; this changes only what the form offers next. */
export function ClientRow({ client }: { client: ClientRowData }) {
  const router = useRouter();
  const [ask, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [vault, setVault] = useState(client.vault && isAddress(client.vault) ? getAddress(client.vault) : client.vault ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await postJson("/api/vendor/clients", { action: "update", id: client.id, name, vault, email });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't save the client.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const yes = await ask({
      title: `Remove ${client.name}?`,
      body: "They disappear from your client list and the invoice form. Invoices you already sealed to them are not changed.",
      confirmLabel: "Remove client",
      destructive: true,
    });
    if (!yes) return;
    setBusy(true);
    setProblem(null);
    try {
      await postJson("/api/vendor/clients", { action: "remove", id: client.id });
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't remove the client.");
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="py-4">
        <form onSubmit={save} className="max-w-xl space-y-3">
          <Field label="Their name">
            {(a) => <input {...a} className={controlClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={200} />}
          </Field>
          <Field label="Vault address">
            {(a) => <input {...a} className={`${controlClass} font-mono`} value={vault} onChange={(e) => setVault(e.target.value)} placeholder="0x…" spellCheck={false} />}
          </Field>
          <Field label="Email">
            {(a) => <input {...a} className={controlClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@company.example" spellCheck={false} />}
          </Field>
          {problem ? <InlineError>{problem}</InlineError> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" busy={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { setEditing(false); setProblem(null); setName(client.name); setVault(client.vault && isAddress(client.vault) ? getAddress(client.vault) : client.vault ?? ""); setEmail(client.email ?? ""); }}>Cancel</Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-4">
      {confirmDialog}
      <div className="min-w-0">
        <p className="font-medium text-ink">{shortenAddressesIn(client.name)}</p>
        {client.vault ? <div className="mt-0.5 text-sm text-graphite"><Address value={client.vault} full copy /></div> : null}
        {client.email ? <p className="mt-0.5 break-words text-sm text-graphite">{client.email}</p> : null}
        {problem ? <p className="mt-1 text-sm text-red">{problem}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={busy}>Edit</Button>
        <Button size="sm" variant="secondary" onClick={() => void remove()} busy={busy}>Remove</Button>
      </div>
    </li>
  );
}
