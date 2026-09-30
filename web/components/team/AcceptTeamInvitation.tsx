"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";

export function AcceptTeamInvitation({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleAccept() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ ok: boolean; businessId: string }>(
        `/api/team-invite/${token}`,
        {},
      );
      if (res.ok) {
        router.push("/business");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to accept team invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8">
      <button
        onClick={handleAccept}
        disabled={busy}
        className="rounded-doc bg-ink px-6 py-3 text-sm font-medium text-paper hover:bg-ink/90 disabled:opacity-50 transition-colors"
      >
        {busy ? "Joining team..." : "Accept team invitation"}
      </button>

      {error && <p className="mt-3 text-xs text-crimson">{error}</p>}
    </div>
  );
}
