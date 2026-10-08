"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client/api";

export function RevokeInvitation({ businessId, invitationId }: { businessId: string; invitationId: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <span className="flex items-center gap-3">
      {error ? <span role="alert" className="text-sm text-red">{error}</span> : null}
      <Button
        variant="danger"
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true); setError("");
          try { await postJson(`/api/business/${businessId}/vendors`, { action: "revoke", invitationId }); router.refresh(); }
          catch (e) { setError(e instanceof Error ? e.message : "Couldn't withdraw that invitation."); setBusy(false); }
        }}
      >
        {busy ? "Withdrawing…" : "Withdraw"}
      </Button>
    </span>
  );
}
