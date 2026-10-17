"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { formatDateTime } from "@/lib/format";

/**
 * "Checked <time> · Re-check now" under what's stopping a payment (SYM-27). The list is read live when the page is drawn,
 * so re-checking draws it again from the Vault and the chain; nothing is paid or changed.
 */
export function RecheckNow({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <p className="mt-3 text-sm text-graphite" aria-live="polite">
      {pending ? "Checking again…" : <>Checked {formatDateTime(checkedAt)}</>}
      {" · "}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
        className="inline-flex min-h-11 items-center text-ink underline decoration-rule underline-offset-4 hover:text-seal disabled:opacity-60 sm:min-h-0"
      >
        Re-check now
      </button>
    </p>
  );
}
