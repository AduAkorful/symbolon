"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { buttonClass } from "@/components/ui/button";

/**
 * Accepting an invitation says what happened in place (plan 05zl, QA retest 3b): it used to send the vendor to Checks, which says
 * "No checks waiting" and gave no sign the link had worked. A business that needs a second person to confirm says so.
 */
export function AcceptInvitation({ token, businessName }: { token: string; businessName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ status: string } | null>(null);

  if (done) {
    const verified = done.status === "verified";
    return (
      <div className="mt-8 space-y-4" role="status">
        <p className="font-medium text-ink">
          {verified ? `Your Seal is linked to ${businessName}.` : `Your Seal is linked to ${businessName}, and a second person there still has to confirm you.`}
        </p>
        <p className="text-graphite">
          {verified
            ? `${businessName} now lists you as verified, through its invitation. It still has to add you as a payee before it can pay you.`
            : `You’re waiting on ${businessName}; nothing more is needed from you for the check.`}
        </p>
        <p className="text-graphite">
          Next: make sure there is an address to be paid at. Without one, the business can’t add you as a payee. Set it in your settings, or sign an invoice, which
          carries the address it pays.
        </p>
        <p className="flex flex-wrap gap-3">
          <Link href="/vendor/settings" className={buttonClass()}>Set where you’re paid</Link>
          <Link href="/vendor/new" className={buttonClass({ variant: "secondary" })}>Make an invoice</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await postJson<{ status?: string }>("/api/vendor/invitation", { token });
            setDone({ status: result.status ?? "verified" });
          } catch (e) {
            setError(e instanceof Error ? e.message : "This invitation can't be used.");
            setBusy(false);
          }
        }}
        className={buttonClass()}
      >
        {busy ? "Linking your Seal…" : "Link my Seal to this business"}
      </button>
      {error ? <p role="alert" className="mt-3 text-sm text-red">{error}</p> : null}
    </div>
  );
}
