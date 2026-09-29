"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";

export function AcceptInvitation({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return <div className="mt-8">
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await postJson("/api/vendor/invitation", { token }); router.push("/v/verify"); }
      catch (e) { setError(e instanceof Error ? e.message : "This invitation can't be used."); setBusy(false); }
    }} className="rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-60">{busy ? "Linking your Seal…" : "Link my Seal to this business"}</button>
    {error ? <p role="alert" className="mt-3 text-sm text-red">{error}</p> : null}
  </div>;
}
