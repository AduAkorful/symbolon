"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client/api";

export function ManageVendorBlock({ businessId, seal, blocked, canUnblock }: { businessId: string; seal: string; blocked: boolean; canUnblock: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function setStatus(action: "block" | "unblock") {
    setBusy(true);
    setMessage("");
    try {
      await postJson("/api/business/" + businessId + "/vendors", { action, seal });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't update this vendor.");
    } finally {
      setBusy(false);
    }
  }

  if (blocked && !canUnblock) return <p className="text-sm text-graphite">Only an owner can unblock this Seal.</p>;
  return <div>
    <button type="button" onClick={() => setStatus(blocked ? "unblock" : "block")} disabled={busy} className="rounded border border-rule px-3 py-2 text-sm hover:border-ink disabled:opacity-60">
      {busy ? "Saving…" : blocked ? "Unblock this Seal" : "Block this Seal"}
    </button>
    {message ? <p role="alert" className="mt-2 text-sm text-red">{message}</p> : null}
  </div>;
}
