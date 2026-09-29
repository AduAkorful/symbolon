"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";

export function RevokeInvitation({ businessId, invitationId }: { businessId: string; invitationId: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <span><button disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await postJson(`/api/business/${businessId}/vendors`, { action: "revoke", invitationId }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't revoke that invitation."); setBusy(false); }
  }} className="text-xs underline disabled:opacity-50">{busy ? "Revoking…" : "Revoke"}</button>{error ? <span role="alert" className="ml-2 text-xs text-red">{error}</span> : null}</span>;
}
