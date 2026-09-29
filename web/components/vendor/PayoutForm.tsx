"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";

/** The payout address new invoices start with. Blank means your Seal's own wallet. */
export function PayoutForm({ initial, sealAddress }: { initial: string | null; sealAddress: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const r = await postJson<{ payoutAddress: string | null }>("/api/vendor/settings", { payoutAddress: value });
      setValue(r.payoutAddress ?? "");
      setNote({ ok: true, text: r.payoutAddress ? "Saved. New invoices will pay out here." : "Saved. New invoices will pay out to your Seal’s wallet." });
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-xl">
      <label className="block text-sm">
        Payout address on Arc
        <input
          className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 font-mono text-sm focus:border-ink focus:outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={sealAddress}
          spellCheck={false}
        />
      </label>
      <p className="mt-2 text-xs text-graphite">Leave it blank to be paid at your Seal’s wallet. Invoices you have already signed keep the address they were signed with.</p>
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`mt-3 text-sm ${note.ok ? "text-seal" : "text-red"}`}>
          {note.text}
        </p>
      ) : null}
      <button disabled={busy} className="mt-4 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
