"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  businessId: string;
  fingerprint: string;
}

export function ReleaseHoldButton({ businessId, fingerprint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRelease() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/business/${businessId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", fingerprint }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to release hold.");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to release hold.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleRelease}
        disabled={busy}
        className="rounded-doc border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "Releasing hold…" : "Release the hold"}
      </button>
      {error ? <p className="mt-1.5 text-xs text-red">{error}</p> : null}
    </div>
  );
}
