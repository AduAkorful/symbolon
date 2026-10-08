"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { InlineError } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";

const box = controlClass;

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
    <form onSubmit={add} className="mt-10 max-w-xl space-y-4 rounded-doc border border-rule px-6 py-6">
      <SectionTitle>Add a client</SectionTitle>
      <Field label="Their name">
        {(a) => <input {...a} className={controlClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={200} />}
      </Field>
      <Segmented
        label="How to reach them"
        value={by}
        options={[{ value: "vault", label: "Their Vault address" }, { value: "email", label: "Their email" }]}
        onChange={setBy}
      />
      <Field label={by === "vault" ? "Vault address" : "Email"}>
        {(a) => <input {...a} className={`${controlClass} ${by === "vault" ? "font-mono" : ""}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={by === "vault" ? "0x…" : "ap@company.example"} spellCheck={false} required />}
      </Field>
      {problem ? <InlineError>{problem}</InlineError> : null}
      <Button type="submit" busy={busy}>{busy ? "Saving…" : "Save the client"}</Button>
    </form>
  );
}
