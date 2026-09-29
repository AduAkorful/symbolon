"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";

const box = "rounded-doc border border-rule bg-paper px-3 py-2 text-[15px] focus:border-ink focus:outline-none";

/** Adds (or updates) a client: a name and a Vault address or an email. Symbolon doesn't list businesses; you enter theirs. */
export function ClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [by, setBy] = useState<"vault" | "email">("vault");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await postJson("/api/vendor/clients", { name, ...(by === "vault" ? { vault: value } : { email: value }) });
      setName("");
      setValue("");
      router.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mt-8 max-w-xl space-y-3 rounded-doc border border-rule p-4">
      <h2 className="font-display text-xl">Add a client</h2>
      <label className="block text-sm">
        Their name
        <input className={`${box} mt-1 w-full`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={200} />
      </label>
      <div role="radiogroup" aria-label="How to reach them" className="flex gap-4 text-sm">
        {(["vault", "email"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="radio" name="by" checked={by === k} onChange={() => setBy(k)} />
            {k === "vault" ? "Their Vault address" : "Their email"}
          </label>
        ))}
      </div>
      <input className={`${box} w-full ${by === "vault" ? "font-mono" : ""}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={by === "vault" ? "0x…" : "ap@company.example"} aria-label={by === "vault" ? "Vault address" : "Email"} required />
      {problem ? (
        <p role="alert" className="text-sm text-red">
          {problem}
        </p>
      ) : null}
      <button disabled={busy} className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40">
        {busy ? "Saving…" : "Save client"}
      </button>
    </form>
  );
}
